import { describe, expect, it } from 'vitest';
import { GOAL_STATES, canTransition, isFinal, transition, type GoalState } from '../src/core/goals';
import { DomainError } from '../src/core/shared';

const LEGAL: [GoalState, GoalState][] = [
  ['DRAFT', 'RULES_PROPOSED'],
  ['RULES_PROPOSED', 'RULES_PROPOSED'],
  ['RULES_PROPOSED', 'AWAITING_STAKE'],
  ['AWAITING_STAKE', 'ACTIVE'],
  ['ACTIVE', 'PROOF_SUBMITTED'],
  ['ACTIVE', 'SETTLED_RELEASED'],
  ['ACTIVE', 'SETTLED_PARTIAL'],
  ['ACTIVE', 'SETTLED_FORFEITED'],
  ['ACTIVE', 'IN_REVIEW'],
  ['PROOF_SUBMITTED', 'ACTIVE'],
  ['PROOF_SUBMITTED', 'SETTLED_RELEASED'],
  ['PROOF_SUBMITTED', 'SETTLED_PARTIAL'],
  ['PROOF_SUBMITTED', 'SETTLED_FORFEITED'],
  ['PROOF_SUBMITTED', 'IN_REVIEW'],
  ['IN_REVIEW', 'SETTLED_RELEASED'],
  ['IN_REVIEW', 'SETTLED_PARTIAL'],
  ['IN_REVIEW', 'SETTLED_FORFEITED'],
  ['SETTLED_PARTIAL', 'REFUNDED'],
  ['SETTLED_FORFEITED', 'REFUNDED'],
];

describe('goal state machine', () => {
  it.each(LEGAL)('allows %s -> %s', (from, to) => {
    expect(transition(from, to)).toBe(to);
  });

  it('rejects every transition that is not on the list', () => {
    const legal = new Set(LEGAL.map(([from, to]) => `${from}>${to}`));
    let rejected = 0;
    for (const from of GOAL_STATES) {
      for (const to of GOAL_STATES) {
        if (legal.has(`${from}>${to}`)) continue;
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
        expect(() => transition(from, to)).toThrow(DomainError);
        rejected++;
      }
    }
    expect(rejected).toBe(GOAL_STATES.length ** 2 - LEGAL.length);
  });

  it('cannot skip the stake, un-settle, or refund money that was never taken', () => {
    expect(canTransition('RULES_PROPOSED', 'ACTIVE')).toBe(false);
    expect(canTransition('SETTLED_FORFEITED', 'ACTIVE')).toBe(false);
    expect(canTransition('SETTLED_RELEASED', 'REFUNDED')).toBe(false);
    expect(canTransition('REFUNDED', 'REFUNDED')).toBe(false);
  });

  it('knows which states are final', () => {
    expect(GOAL_STATES.filter(isFinal)).toEqual(['SETTLED_RELEASED', 'REFUNDED']);
  });
});
