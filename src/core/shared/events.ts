import type { Money } from './money';
import type { ProofRules } from './proof-rules';
import type { ReviewDecision, Verdict } from './verdict';

/**
 * Every fact one module tells the others. Events carry the data their handlers
 * need, because modules may not read each other's storage.
 */
export type DomainEvent =
  | { type: 'GoalCreated'; goalId: string; userId: string; goalText: string; deadline: Date; stake: Money }
  | { type: 'RulesProposed'; goalId: string }
  | { type: 'RulesAccepted'; goalId: string; rules: ProofRules }
  | { type: 'StakeHeld'; goalId: string; authorizationId: string; amount: Money }
  | {
      type: 'ProofSubmitted';
      goalId: string;
      proofId: string;
      proofUrl: string;
      challengeCode: string;
      rules: ProofRules;
      /** 1 for the first upload */
      attempt: number;
      /** true when no further upload is allowed after this one */
      finalAttempt: boolean;
    }
  | { type: 'VerdictIssued'; goalId: string; verdict: Verdict }
  /** The proof was not good enough, but the user may still upload a better one before the deadline. */
  | { type: 'RetryAllowed'; goalId: string; verdict: Verdict }
  | { type: 'DeadlinePassed'; goalId: string }
  | { type: 'ReviewRequested'; goalId: string; verdict: Verdict }
  | { type: 'ReviewResolved'; goalId: string; decision: ReviewDecision }
  | { type: 'StakeReleased'; goalId: string }
  | {
      type: 'StakeCaptured';
      goalId: string;
      captureId: string;
      amount: Money;
      /** true when only part of the stake was captured and the rest was released */
      partial: boolean;
    }
  | { type: 'AppealUpheld'; goalId: string; refundId: string; amount: Money };

export type EventType = DomainEvent['type'];
export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;
