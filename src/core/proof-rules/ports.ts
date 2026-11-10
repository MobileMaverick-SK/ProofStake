import type { ProofRules } from '../shared';

export interface RuleWriter {
  draftRules(goalText: string, deadline: Date): Promise<ProofRules>;
}

export interface RulesRecord {
  goalId: string;
  goalText: string;
  deadline: Date;
  status: 'DRAFT_FAILED' | 'PROPOSED' | 'ACCEPTED';
  rules?: ProofRules;
}

export interface RulesRepository {
  get(goalId: string): Promise<RulesRecord | null>;
  save(record: RulesRecord): Promise<void>;
}
