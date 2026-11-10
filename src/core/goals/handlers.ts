import type { EventBus } from '../shared';
import type { createGoalsUseCases } from './use-cases';

type Move = ReturnType<typeof createGoalsUseCases>['move'];

/** The goal's state follows what the other modules report. */
export function registerGoalHandlers(bus: EventBus, move: Move): void {
  bus.subscribe('RulesProposed', (e) => move(e.goalId, 'RULES_PROPOSED'));
  bus.subscribe('RulesAccepted', (e) => move(e.goalId, 'AWAITING_STAKE'));
  bus.subscribe('StakeHeld', (e) => move(e.goalId, 'ACTIVE'));
  bus.subscribe('ProofSubmitted', (e) => move(e.goalId, 'PROOF_SUBMITTED'));
  bus.subscribe('RetryAllowed', (e) => move(e.goalId, 'ACTIVE'));
  bus.subscribe('ReviewRequested', (e) => move(e.goalId, 'IN_REVIEW'));
  bus.subscribe('StakeReleased', (e) => move(e.goalId, 'SETTLED_RELEASED'));
  bus.subscribe('StakeCaptured', (e) =>
    move(e.goalId, e.partial ? 'SETTLED_PARTIAL' : 'SETTLED_FORFEITED', {
      capture: { captureId: e.captureId, amount: e.amount },
    }),
  );
  bus.subscribe('AppealUpheld', (e) =>
    move(e.goalId, 'REFUNDED', { refund: { refundId: e.refundId, amount: e.amount } }),
  );
}
