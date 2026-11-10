import { createHash } from 'node:crypto';
import { getApp } from '@/composition-root';
import { isPayoutOpen } from '@/core/pacts';
import { isDomainError } from '@/core/shared';

/** How often an open screen asks again. */
export const BUSY_MS = 5_000;
export const IDLE_MS = 10_000;

export interface Pulse {
  /** fingerprint of what the screen shows */
  version: string;
  /** when to ask again; null when nothing on the screen can change by itself any more */
  nextCheckMs: number | null;
}

async function orNull<T>(load: Promise<T>): Promise<T | null> {
  try {
    return await load;
  } catch (error) {
    if (isDomainError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

/**
 * A short fingerprint of everything a goal screen or pact screen shows that can
 * change by itself: the goal's state, the money, the proof check, appeals, the
 * pact and its payout. Screens ask for it every few seconds and re-read
 * themselves only when it changes. It is a hash, so it reveals nothing.
 */
export async function goalPulse(goalId: string): Promise<Pulse> {
  const app = getApp();
  // Lets due deadlines and payouts happen now instead of at the scheduler's next run.
  await app.checkDeadlines();
  const [goal, stake, slot, verdict, pact, cases] = await Promise.all([
    orNull(app.goals.getGoal(goalId)),
    orNull(app.settlement.getStake(goalId)),
    orNull(app.proofIntake.getProofSlot(goalId)),
    orNull(app.verification.getVerdict(goalId)),
    app.pacts.getForGoal(goalId),
    app.appeals.listCases({ goalId }),
  ]);
  const seen = [
    goal?.state,
    goal?.refund?.refundId,
    stake?.status,
    stake?.holdStatus,
    stake?.pendingAction?.type,
    stake?.lastError?.at,
    stake?.deferredVerdict ? 'deferred' : '',
    stake?.providerNotifiedAt,
    slot?.attempts,
    verdict ? `${verdict.outcome}:${verdict.confidence}` : '',
    pact?.status,
    pact?.outcome,
    pact?.nudge?.at,
    pact?.rules ? 'rules' : '',
    pact?.payout?.status,
    pact?.payout?.providerStatus,
    pact?.payout?.lastError?.at,
    ...cases.map((reviewCase) => `${reviewCase.id}:${reviewCase.status}:${reviewCase.advice?.at ?? ''}`),
  ];
  const version = createHash('sha256').update(JSON.stringify(seen)).digest('hex').slice(0, 16);

  const now = Date.now();
  const soon = (at: Date | undefined) => Boolean(at) && new Date(at!).getTime() - now < 60_000;
  const payout = pact?.payout;
  // Something is about to happen: ask often.
  const busy =
    goal?.state === 'PROOF_SUBMITTED' ||
    Boolean(stake?.pendingAction) ||
    Boolean(stake?.awaitingVerdict) ||
    (payout?.status === 'SCHEDULED' && soon(payout.dueAt)) ||
    (payout?.status === 'SENT' && isPayoutOpen(payout)) ||
    ((goal?.state === 'ACTIVE' || goal?.state === 'AWAITING_STAKE') && soon(goal.deadline));
  // An appeal on a settled goal starts from the user's own click, which re-reads the screen anyway.
  const settled = goal ? ['SETTLED_RELEASED', 'SETTLED_PARTIAL', 'SETTLED_FORFEITED', 'REFUNDED'].includes(goal.state) : true;
  // Settled, with no appeal open and no payout still under way: nothing can change by itself.
  const done =
    !goal ||
    ((settled || (!stake?.authorizationId && goal.deadline.getTime() <= now)) &&
      !cases.some((reviewCase) => reviewCase.status === 'OPEN') &&
      !isPayoutOpen(payout) &&
      !stake?.pendingAction);
  return { version, nextCheckMs: done ? null : busy ? BUSY_MS : IDLE_MS };
}
