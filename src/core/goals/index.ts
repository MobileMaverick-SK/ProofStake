import { registerGoalHandlers } from './handlers';
import { createGoalsUseCases, type GoalsDeps } from './use-cases';

export type { Goal } from './goal';
export { MAX_GOAL_DURATION_MS, MAX_STAKE_CENTS, MIN_STAKE_CENTS, isExpiredWithoutHold } from './goal';
export type { GoalRepository } from './ports';
export { GOAL_STATES, canTransition, isFinal, transition, type GoalState } from './state-machine';

export function createGoalsModule(deps: GoalsDeps) {
  const { move, ...useCases } = createGoalsUseCases(deps);
  registerGoalHandlers(deps.bus, move);
  return useCases;
}
export type GoalsModule = ReturnType<typeof createGoalsModule>;
