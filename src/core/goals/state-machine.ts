import { DomainError } from '../shared';

export const GOAL_STATES = [
  'DRAFT',
  'RULES_PROPOSED',
  'AWAITING_STAKE',
  'ACTIVE',
  'PROOF_SUBMITTED',
  'IN_REVIEW',
  'SETTLED_RELEASED',
  'SETTLED_PARTIAL',
  'SETTLED_FORFEITED',
  'REFUNDED',
] as const;

export type GoalState = (typeof GOAL_STATES)[number];

const TRANSITIONS: Record<GoalState, readonly GoalState[]> = {
  DRAFT: ['RULES_PROPOSED'],
  // RULES_PROPOSED -> RULES_PROPOSED is "regenerate the rules"
  RULES_PROPOSED: ['RULES_PROPOSED', 'AWAITING_STAKE'],
  AWAITING_STAKE: ['ACTIVE'],
  // From ACTIVE a goal settles directly when there is no proof by the deadline, or when
  // the latest (not good enough) proof is accepted as final or the deadline passes on it.
  ACTIVE: ['PROOF_SUBMITTED', 'SETTLED_RELEASED', 'SETTLED_PARTIAL', 'SETTLED_FORFEITED', 'IN_REVIEW'],
  // PROOF_SUBMITTED -> ACTIVE is "not good enough yet, upload again"
  PROOF_SUBMITTED: ['ACTIVE', 'SETTLED_RELEASED', 'SETTLED_PARTIAL', 'SETTLED_FORFEITED', 'IN_REVIEW'],
  IN_REVIEW: ['SETTLED_RELEASED', 'SETTLED_PARTIAL', 'SETTLED_FORFEITED'],
  SETTLED_RELEASED: [],
  SETTLED_PARTIAL: ['REFUNDED'],
  SETTLED_FORFEITED: ['REFUNDED'],
  REFUNDED: [],
};

export function canTransition(from: GoalState, to: GoalState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Returns the new state, or throws ILLEGAL_TRANSITION. */
export function transition(from: GoalState, to: GoalState): GoalState {
  if (!canTransition(from, to)) {
    throw new DomainError('ILLEGAL_TRANSITION', `A goal cannot move from ${from} to ${to}`);
  }
  return to;
}

export function isFinal(state: GoalState): boolean {
  return TRANSITIONS[state].length === 0;
}
