import type { Session, SessionRepository, User, UserRepository } from '../../core/accounts';
import type { CaptureRecord, ReviewCase, ReviewRepository } from '../../core/appeals';
import { isPayoutOpen, type Pact, type PactRepository } from '../../core/pacts';
import type { Goal, GoalRepository } from '../../core/goals';
import type { ProofRepository, ProofSlot } from '../../core/proof-intake';
import type { RulesRecord, RulesRepository } from '../../core/proof-rules';
import type {
  PendingMethodSetup,
  SavedMethod,
  SavedMethodRepository,
  StakeRecord,
  StakeRepository,
} from '../../core/settlement';
import type { Verdict } from '../../core/shared';
import type { VerdictRepository } from '../../core/verification';
import type { WebhookEventEntry, WebhookEventLog } from '../paypal/webhooks';
import { decode, encode, type Db } from './database';

type Row = { data: string };

/** A table with one record per goal, stored whole as JSON. */
class GoalKeyedTable<T> {
  constructor(
    private readonly db: Db,
    private readonly table: 'rules' | 'proof_slots' | 'verdicts' | 'captures',
  ) {}

  read(goalId: string): T | null {
    const row = this.db.prepare(`SELECT data FROM ${this.table} WHERE goal_id = ?`).get(goalId) as Row | undefined;
    return row ? decode<T>(row.data) : null;
  }

  write(goalId: string, value: T): void {
    this.db
      .prepare(
        `INSERT INTO ${this.table} (goal_id, data) VALUES (?, ?)
         ON CONFLICT (goal_id) DO UPDATE SET data = excluded.data`,
      )
      .run(goalId, encode(value));
  }
}

export class SqliteGoalRepository implements GoalRepository {
  constructor(private readonly db: Db) {}

  async get(goalId: string) {
    const row = this.db.prepare('SELECT data FROM goals WHERE id = ?').get(goalId) as Row | undefined;
    return row ? decode<Goal>(row.data) : null;
  }

  async save(goal: Goal) {
    this.db
      .prepare(
        `INSERT INTO goals (id, user_id, state, deadline, deadline_announced, created_at, data)
         VALUES (@id, @userId, @state, @deadline, @announced, @createdAt, @data)
         ON CONFLICT (id) DO UPDATE SET
           state = excluded.state,
           deadline = excluded.deadline,
           deadline_announced = excluded.deadline_announced,
           data = excluded.data`,
      )
      .run({
        id: goal.id,
        userId: goal.userId,
        state: goal.state,
        deadline: goal.deadline.toISOString(),
        announced: goal.deadlineAnnounced ? 1 : 0,
        createdAt: goal.createdAt.toISOString(),
        data: encode(goal),
      });
  }

  async listByUser(userId: string) {
    const rows = this.db
      .prepare('SELECT data FROM goals WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
      .all(userId) as Row[];
    return rows.map((row) => decode<Goal>(row.data));
  }

  async listDueForSettlement(now: Date) {
    // ISO-8601 UTC strings sort in time order, so a text comparison is a time comparison.
    const rows = this.db
      .prepare(`SELECT data FROM goals WHERE state = 'ACTIVE' AND deadline_announced = 0 AND deadline <= ?`)
      .all(now.toISOString()) as Row[];
    return rows.map((row) => decode<Goal>(row.data));
  }
}

export class SqliteRulesRepository implements RulesRepository {
  private readonly table: GoalKeyedTable<RulesRecord>;
  constructor(db: Db) {
    this.table = new GoalKeyedTable(db, 'rules');
  }
  async get(goalId: string) {
    return this.table.read(goalId);
  }
  async save(record: RulesRecord) {
    this.table.write(record.goalId, record);
  }
}

export class SqliteProofRepository implements ProofRepository {
  private readonly table: GoalKeyedTable<ProofSlot>;
  constructor(db: Db) {
    this.table = new GoalKeyedTable(db, 'proof_slots');
  }
  async get(goalId: string) {
    return this.table.read(goalId);
  }
  async save(slot: ProofSlot) {
    this.table.write(slot.goalId, slot);
  }
}

export class SqliteVerdictRepository implements VerdictRepository {
  private readonly table: GoalKeyedTable<Verdict>;
  constructor(db: Db) {
    this.table = new GoalKeyedTable(db, 'verdicts');
  }
  async get(goalId: string) {
    return this.table.read(goalId);
  }
  async save(goalId: string, verdict: Verdict) {
    this.table.write(goalId, verdict);
  }
}

export class SqliteStakeRepository implements StakeRepository {
  constructor(private readonly db: Db) {}

  async get(goalId: string) {
    const row = this.db.prepare('SELECT data FROM stakes WHERE goal_id = ?').get(goalId) as Row | undefined;
    return row ? decode<StakeRecord>(row.data) : null;
  }

  async save(record: StakeRecord) {
    this.db
      .prepare(
        `INSERT INTO stakes (goal_id, pending, data) VALUES (?, ?, ?)
         ON CONFLICT (goal_id) DO UPDATE SET pending = excluded.pending, data = excluded.data`,
      )
      .run(record.goalId, record.pendingAction ? 1 : 0, encode(record));
  }

  async listPending() {
    const rows = this.db.prepare('SELECT data FROM stakes WHERE pending = 1').all() as Row[];
    return rows.map((row) => decode<StakeRecord>(row.data));
  }

  async findByAuthorization(authorizationId: string) {
    const row = this.db
      .prepare(`SELECT data FROM stakes WHERE json_extract(data, '$.authorizationId') = ?`)
      .get(authorizationId) as Row | undefined;
    return row ? decode<StakeRecord>(row.data) : null;
  }
}

export class SqliteReviewRepository implements ReviewRepository {
  private readonly captures: GoalKeyedTable<CaptureRecord>;
  constructor(private readonly db: Db) {
    this.captures = new GoalKeyedTable(db, 'captures');
  }

  async getCase(caseId: string) {
    const row = this.db.prepare('SELECT data FROM review_cases WHERE id = ?').get(caseId) as Row | undefined;
    return row ? decode<ReviewCase>(row.data) : null;
  }

  async saveCase(reviewCase: ReviewCase) {
    this.db
      .prepare(
        `INSERT INTO review_cases (id, goal_id, status, created_at, data)
         VALUES (@id, @goalId, @status, @createdAt, @data)
         ON CONFLICT (id) DO UPDATE SET status = excluded.status, data = excluded.data`,
      )
      .run({
        id: reviewCase.id,
        goalId: reviewCase.goalId,
        status: reviewCase.status,
        createdAt: reviewCase.createdAt.toISOString(),
        data: encode(reviewCase),
      });
  }

  async listCases(filter: { status?: ReviewCase['status']; goalId?: string } = {}) {
    const rows = this.db
      .prepare(
        `SELECT data FROM review_cases
         WHERE (@status IS NULL OR status = @status) AND (@goalId IS NULL OR goal_id = @goalId)
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all({ status: filter.status ?? null, goalId: filter.goalId ?? null }) as Row[];
    return rows.map((row) => decode<ReviewCase>(row.data));
  }

  async getCapture(goalId: string) {
    return this.captures.read(goalId);
  }

  async saveCapture(capture: CaptureRecord) {
    this.captures.write(capture.goalId, capture);
  }
}

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async getById(userId: string) {
    const row = this.db.prepare('SELECT data FROM users WHERE id = ?').get(userId) as Row | undefined;
    return row ? decode<User>(row.data) : null;
  }

  async getByEmail(email: string) {
    const row = this.db.prepare('SELECT data FROM users WHERE email = ?').get(email) as Row | undefined;
    return row ? decode<User>(row.data) : null;
  }

  async save(user: User) {
    this.db
      .prepare(
        `INSERT INTO users (id, email, data) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET email = excluded.email, data = excluded.data`,
      )
      .run(user.id, user.email, encode(user));
  }
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  async get(tokenHash: string): Promise<Session | null> {
    const row = this.db
      .prepare('SELECT token_hash, user_id, expires_at FROM sessions WHERE token_hash = ?')
      .get(tokenHash) as { token_hash: string; user_id: string; expires_at: string } | undefined;
    return row ? { tokenHash: row.token_hash, userId: row.user_id, expiresAt: new Date(row.expires_at) } : null;
  }

  async save(session: Session) {
    this.db
      .prepare('INSERT OR REPLACE INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(session.tokenHash, session.userId, session.expiresAt.toISOString());
  }

  async delete(tokenHash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }
}

export class SqliteSavedMethodRepository implements SavedMethodRepository {
  constructor(private readonly db: Db) {}

  async get(userId: string) {
    const row = this.db.prepare('SELECT data FROM saved_methods WHERE user_id = ?').get(userId) as Row | undefined;
    return row ? decode<SavedMethod>(row.data) : null;
  }

  async save(method: SavedMethod) {
    this.db
      .prepare(
        `INSERT INTO saved_methods (user_id, data) VALUES (?, ?)
         ON CONFLICT (user_id) DO UPDATE SET data = excluded.data`,
      )
      .run(method.userId, encode(method));
  }

  async delete(userId: string) {
    this.db.prepare('DELETE FROM saved_methods WHERE user_id = ?').run(userId);
  }

  async getPending(userId: string) {
    const row = this.db.prepare('SELECT data FROM pending_method_setups WHERE user_id = ?').get(userId) as Row | undefined;
    return row ? decode<PendingMethodSetup>(row.data) : null;
  }

  async savePending(setup: PendingMethodSetup) {
    this.db
      .prepare(
        `INSERT INTO pending_method_setups (user_id, data) VALUES (?, ?)
         ON CONFLICT (user_id) DO UPDATE SET data = excluded.data`,
      )
      .run(setup.userId, encode(setup));
  }

  async deletePending(userId: string) {
    this.db.prepare('DELETE FROM pending_method_setups WHERE user_id = ?').run(userId);
  }
}

export class SqlitePactRepository implements PactRepository {
  constructor(private readonly db: Db) {}

  async get(goalId: string) {
    const row = this.db.prepare('SELECT data FROM pacts WHERE goal_id = ?').get(goalId) as Row | undefined;
    return row ? decode<Pact>(row.data) : null;
  }

  async getByToken(token: string) {
    const row = this.db.prepare('SELECT data FROM pacts WHERE token = ?').get(token) as Row | undefined;
    return row ? decode<Pact>(row.data) : null;
  }

  async save(pact: Pact) {
    this.db
      .prepare(
        `INSERT INTO pacts (goal_id, token, payout_open, data) VALUES (?, ?, ?, ?)
         ON CONFLICT (goal_id) DO UPDATE SET payout_open = excluded.payout_open, data = excluded.data`,
      )
      .run(pact.goalId, pact.token, isPayoutOpen(pact.payout) ? 1 : 0, encode(pact));
  }

  async listOpenPayouts() {
    const rows = this.db.prepare('SELECT data FROM pacts WHERE payout_open = 1').all() as Row[];
    return rows.map((row) => decode<Pact>(row.data));
  }
}

/** PayPal webhook events we have received, kept so each is handled once and can be shown to a reviewer. */
export class SqliteWebhookEventLog implements WebhookEventLog {
  constructor(private readonly db: Db) {}

  async has(eventId: string) {
    return Boolean(this.db.prepare('SELECT 1 FROM webhook_events WHERE id = ?').get(eventId));
  }

  async record(entry: WebhookEventEntry) {
    this.db
      .prepare('INSERT OR REPLACE INTO webhook_events (id, received_at, data) VALUES (?, ?, ?)')
      .run(entry.id, entry.receivedAt.toISOString(), encode(entry));
  }

  async recent(limit: number) {
    const rows = this.db.prepare('SELECT data FROM webhook_events ORDER BY received_at DESC LIMIT ?').all(limit) as Row[];
    return rows.map((row) => decode<WebhookEventEntry>(row.data));
  }
}

export function createSqliteRepositories(db: Db) {
  return {
    pactRepository: new SqlitePactRepository(db),
    savedMethodRepository: new SqliteSavedMethodRepository(db),
    userRepository: new SqliteUserRepository(db),
    sessionRepository: new SqliteSessionRepository(db),
    goalRepository: new SqliteGoalRepository(db),
    rulesRepository: new SqliteRulesRepository(db),
    proofRepository: new SqliteProofRepository(db),
    verdictRepository: new SqliteVerdictRepository(db),
    stakeRepository: new SqliteStakeRepository(db),
    reviewRepository: new SqliteReviewRepository(db),
  };
}
