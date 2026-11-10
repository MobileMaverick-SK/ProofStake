import { createProofRulesUseCases, type ProofRulesDeps } from './use-cases';

export type { RuleWriter, RulesRecord, RulesRepository } from './ports';

export function createProofRulesModule(deps: ProofRulesDeps) {
  const { draft, ...useCases } = createProofRulesUseCases(deps);
  deps.bus.subscribe('GoalCreated', async (e) => {
    await draft({ goalId: e.goalId, goalText: e.goalText, deadline: e.deadline });
  });
  return useCases;
}
export type ProofRulesModule = ReturnType<typeof createProofRulesModule>;
