import { createSettlementUseCases, type SettlementDeps } from './use-cases';

export { DEFAULT_CONFIDENCE_THRESHOLD, decideSettlement, type SettlementAction, type SettlementInput } from './policy';
export type {
  HoldStatus,
  PaymentMethodVault,
  PendingMethodSetup,
  SavedMethod,
  SavedMethodRef,
  SavedMethodRepository,
  StakeHolds,
  StakeRecord,
  StakeRepository,
} from './ports';

export function createSettlementModule(deps: SettlementDeps) {
  const uc = createSettlementUseCases(deps);
  const { bus } = deps;
  bus.subscribe('GoalCreated', (e) => uc.onGoalCreated(e.goalId, e.userId, e.stake, e.deadline));
  bus.subscribe('RulesAccepted', (e) => uc.onRulesAccepted(e.goalId));
  bus.subscribe('ProofSubmitted', (e) => uc.onProofSubmitted(e.goalId, e.finalAttempt));
  bus.subscribe('VerdictIssued', (e) => uc.onVerdict(e.goalId, e.verdict));
  bus.subscribe('DeadlinePassed', (e) => uc.onDeadlinePassed(e.goalId));
  bus.subscribe('ReviewResolved', (e) => uc.onReviewResolved(e.goalId, e.decision));
  return {
    getStake: uc.getStake,
    startHold: uc.startHold,
    confirmHold: uc.confirmHold,
    holdWithSavedMethod: uc.holdWithSavedMethod,
    getSavedMethod: uc.getSavedMethod,
    forgetSavedMethod: uc.forgetSavedMethod,
    startSavingMethod: uc.startSavingMethod,
    finishSavingMethod: uc.finishSavingMethod,
    cancelSavingMethod: uc.cancelSavingMethod,
    acceptResult: uc.acceptResult,
    retrySettlement: uc.retrySettlement,
    retryPendingSettlements: uc.retryPendingSettlements,
    syncHold: uc.syncHold,
  };
}
export type SettlementModule = ReturnType<typeof createSettlementModule>;
