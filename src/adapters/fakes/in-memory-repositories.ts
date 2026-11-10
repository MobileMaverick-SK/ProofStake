import type { Verdict } from '../../core/shared';
import type { Session, SessionRepository, User, UserRepository } from '../../core/accounts';
import type { CaptureRecord, ReviewCase, ReviewRepository } from '../../core/appeals';
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
import type { VerdictRepository } from '../../core/verification';

/** Values are cloned on the way in and out, so callers cannot mutate stored state by accident. */
class Table<T> {
  private readonly rows = new Map<string, T>();
  get(key: string): T | null {
    const row = this.rows.get(key);
    return row === undefined ? null : structuredClone(row);
  }
  set(key: string, value: T): void {
    this.rows.set(key, structuredClone(value));
  }
  all(): T[] {
    return [...this.rows.values()].map((row) => structuredClone(row));
  }
}

export class InMemoryGoalRepository implements GoalRepository {
  private readonly table = new Table<Goal>();
  async get(goalId: string) {
    return this.table.get(goalId);
  }
  async save(goal: Goal) {
    this.table.set(goal.id, goal);
  }
  async listByUser(userId: string) {
    return this.table
      .all()
      .filter((goal) => goal.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async listDueForSettlement(now: Date) {
    return this.table
      .all()
      .filter((g) => g.state === 'ACTIVE' && !g.deadlineAnnounced && g.deadline.getTime() <= now.getTime());
  }
}

export class InMemoryRulesRepository implements RulesRepository {
  private readonly table = new Table<RulesRecord>();
  async get(goalId: string) {
    return this.table.get(goalId);
  }
  async save(record: RulesRecord) {
    this.table.set(record.goalId, record);
  }
}

export class InMemoryProofRepository implements ProofRepository {
  private readonly table = new Table<ProofSlot>();
  async get(goalId: string) {
    return this.table.get(goalId);
  }
  async save(slot: ProofSlot) {
    this.table.set(slot.goalId, slot);
  }
}

export class InMemoryVerdictRepository implements VerdictRepository {
  private readonly table = new Table<Verdict>();
  async get(goalId: string) {
    return this.table.get(goalId);
  }
  async save(goalId: string, verdict: Verdict) {
    this.table.set(goalId, verdict);
  }
}

export class InMemoryStakeRepository implements StakeRepository {
  private readonly table = new Table<StakeRecord>();
  async get(goalId: string) {
    return this.table.get(goalId);
  }
  async save(record: StakeRecord) {
    this.table.set(record.goalId, record);
  }
  async listPending() {
    return this.table.all().filter((stake) => stake.pendingAction !== undefined);
  }
}

export class InMemoryReviewRepository implements ReviewRepository {
  private readonly cases = new Table<ReviewCase>();
  private readonly captures = new Table<CaptureRecord>();
  async getCase(caseId: string) {
    return this.cases.get(caseId);
  }
  async saveCase(reviewCase: ReviewCase) {
    this.cases.set(reviewCase.id, reviewCase);
  }
  async listCases(filter: { status?: ReviewCase['status']; goalId?: string } = {}) {
    return this.cases
      .all()
      .filter((c) => (!filter.status || c.status === filter.status) && (!filter.goalId || c.goalId === filter.goalId))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async getCapture(goalId: string) {
    return this.captures.get(goalId);
  }
  async saveCapture(capture: CaptureRecord) {
    this.captures.set(capture.goalId, capture);
  }
}

export class InMemoryUserRepository implements UserRepository {
  private readonly table = new Table<User>();
  async getById(userId: string) {
    return this.table.get(userId);
  }
  async getByEmail(email: string) {
    return this.table.all().find((user) => user.email === email) ?? null;
  }
  async save(user: User) {
    this.table.set(user.id, user);
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly table = new Map<string, Session>();
  async get(tokenHash: string) {
    const session = this.table.get(tokenHash);
    return session ? structuredClone(session) : null;
  }
  async save(session: Session) {
    this.table.set(session.tokenHash, structuredClone(session));
  }
  async delete(tokenHash: string) {
    this.table.delete(tokenHash);
  }
}

export class InMemorySavedMethodRepository implements SavedMethodRepository {
  private readonly methods = new Map<string, SavedMethod>();
  private readonly pending = new Map<string, PendingMethodSetup>();
  async get(userId: string) {
    const method = this.methods.get(userId);
    return method ? structuredClone(method) : null;
  }
  async save(method: SavedMethod) {
    this.methods.set(method.userId, structuredClone(method));
  }
  async delete(userId: string) {
    this.methods.delete(userId);
  }
  async getPending(userId: string) {
    const setup = this.pending.get(userId);
    return setup ? structuredClone(setup) : null;
  }
  async savePending(setup: PendingMethodSetup) {
    this.pending.set(setup.userId, structuredClone(setup));
  }
  async deletePending(userId: string) {
    this.pending.delete(userId);
  }
}
