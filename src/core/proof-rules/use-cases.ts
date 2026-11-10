import { DomainError, notFound, proofRulesSchema, type EventBus, type ProofRules } from '../shared';
import type { RuleWriter, RulesRecord, RulesRepository } from './ports';

export interface ProofRulesDeps {
  rules: RulesRepository;
  writer: RuleWriter;
  bus: EventBus;
}

export function createProofRulesUseCases({ rules, writer, bus }: ProofRulesDeps) {
  async function load(goalId: string): Promise<RulesRecord> {
    const record = await rules.get(goalId);
    if (!record) throw notFound('Rules for goal', goalId);
    return record;
  }

  /** Asks the writer for rules. A writer failure is recorded, not thrown, so the user can retry. */
  async function draft(base: Pick<RulesRecord, 'goalId' | 'goalText' | 'deadline'>): Promise<RulesRecord> {
    let drafted: ProofRules | null = null;
    try {
      // The writer is outside our control (an AI model), so its output is validated here too.
      drafted = proofRulesSchema.parse(await writer.draftRules(base.goalText, base.deadline));
    } catch {
      drafted = null;
    }
    const record: RulesRecord = drafted
      ? { ...base, status: 'PROPOSED', rules: drafted }
      : { ...base, status: 'DRAFT_FAILED' };
    await rules.save(record);
    if (drafted) await bus.publish({ type: 'RulesProposed', goalId: base.goalId });
    return record;
  }

  return {
    draft,

    getRules: load,

    async regenerateRules(goalId: string): Promise<RulesRecord> {
      const record = await load(goalId);
      if (record.status === 'ACCEPTED') {
        throw new DomainError('CONFLICT', 'These rules were already accepted and cannot be changed');
      }
      return draft(record);
    },

    async acceptRules(goalId: string): Promise<RulesRecord> {
      const record = await load(goalId);
      if (record.status === 'ACCEPTED') return record;
      if (record.status !== 'PROPOSED' || !record.rules) {
        throw new DomainError('CONFLICT', 'There are no proposed rules to accept yet');
      }
      const accepted: RulesRecord = { ...record, status: 'ACCEPTED' };
      await rules.save(accepted);
      await bus.publish({ type: 'RulesAccepted', goalId, rules: record.rules });
      return accepted;
    },
  };
}
