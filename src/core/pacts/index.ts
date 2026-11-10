import { createPactsUseCases, type PactsDeps } from './use-cases';

export { isPayoutOpen } from './ports';
export type { Pact, PactPayout, PactRepository, Payouts, PayoutStatus } from './ports';
export { DEFAULT_APPEAL_WINDOW_MS, MAX_NUDGE_LENGTH, validatePartner } from './use-cases';

export function createPactsModule(deps: PactsDeps) {
  const {
    onRulesAccepted,
    onStakeHeld,
    onStakeReleased,
    onStakeCaptured,
    onAppealFiled,
    onAppealRejected,
    onAppealUpheld,
    ...useCases
  } = createPactsUseCases(deps);
  deps.bus.subscribe('RulesAccepted', (e) => onRulesAccepted(e.goalId, e.rules));
  deps.bus.subscribe('StakeHeld', (e) => onStakeHeld(e.goalId));
  deps.bus.subscribe('StakeReleased', (e) => onStakeReleased(e.goalId));
  deps.bus.subscribe('StakeCaptured', (e) => onStakeCaptured(e.goalId, e.amount));
  deps.bus.subscribe('AppealFiled', (e) => onAppealFiled(e.goalId));
  deps.bus.subscribe('AppealRejected', (e) => onAppealRejected(e.goalId));
  deps.bus.subscribe('AppealUpheld', (e) => onAppealUpheld(e.goalId));
  return useCases;
}
export type PactsModule = ReturnType<typeof createPactsModule>;
