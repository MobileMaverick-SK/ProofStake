import { z } from 'zod';
import { DomainError, err, ok, type Money, type Result } from '../shared';
import type { GoalState } from './state-machine';

/** Goals last at most 3 days so the PayPal hold stays inside its initial honor period. */
export const MAX_GOAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
export const MIN_STAKE_CENTS = 100;
export const MAX_STAKE_CENTS = 50_000;

export interface Goal {
  id: string;
  /** the account that owns this goal */
  userId: string;
  text: string;
  deadline: Date;
  stake: Money;
  state: GoalState;
  createdAt: Date;
  /** set once the scheduler has announced the deadline, so it is announced only once */
  deadlineAnnounced: boolean;
  capture?: { captureId: string; amount: Money };
  refund?: { refundId: string; amount: Money };
}

/** A goal whose deadline passed before any money was held. Nothing is owed and nothing more can happen to it. */
export function isExpiredWithoutHold(goal: Pick<Goal, 'state' | 'deadline'>, now: Date): boolean {
  const beforeHold = goal.state === 'DRAFT' || goal.state === 'RULES_PROPOSED' || goal.state === 'AWAITING_STAKE';
  return beforeHold && goal.deadline.getTime() <= now.getTime();
}

const newGoalSchema = z.object({
  text: z.string().trim().min(5, 'Describe the goal in at least 5 characters').max(500),
  deadline: z.date(),
  stakeCents: z
    .number()
    .int('Stake must be a whole number of cents')
    .min(MIN_STAKE_CENTS, 'The minimum stake is $1.00')
    .max(MAX_STAKE_CENTS, 'The maximum stake is $500.00'),
});

export type NewGoalInput = z.infer<typeof newGoalSchema>;

export function validateNewGoal(input: unknown, now: Date): Result<NewGoalInput, DomainError> {
  const parsed = newGoalSchema.safeParse(input);
  if (!parsed.success) {
    return err(new DomainError('VALIDATION', parsed.error.issues.map((i) => i.message).join('; ')));
  }
  const untilDeadline = parsed.data.deadline.getTime() - now.getTime();
  if (untilDeadline <= 0) {
    return err(new DomainError('VALIDATION', 'The deadline must be in the future'));
  }
  if (untilDeadline > MAX_GOAL_DURATION_MS) {
    return err(new DomainError('VALIDATION', 'The deadline can be at most 3 days from now'));
  }
  return ok(parsed.data);
}
