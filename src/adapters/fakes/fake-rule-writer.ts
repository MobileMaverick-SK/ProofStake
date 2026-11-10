import type { ProofRules } from '../../core/shared';
import type { RuleWriter } from '../../core/proof-rules';

export const SAMPLE_RULES: ProofRules = {
  checks: [
    { id: 'shows-work', description: 'The photo shows the finished work described in the goal.', required: true },
    { id: 'legible', description: 'The work is legible and clearly the main subject of the photo.', required: true },
  ],
  partialCompletion: { measurable: true, description: 'Fraction of the described work that is visibly finished.' },
};

export class FakeRuleWriter implements RuleWriter {
  calls = 0;
  /** Set to make the next call fail, like an AI outage. */
  failNext = false;

  constructor(private readonly rules: ProofRules = SAMPLE_RULES) {}

  async draftRules(): Promise<ProofRules> {
    this.calls++;
    if (this.failNext) {
      this.failNext = false;
      throw new Error('fake rule writer outage');
    }
    return structuredClone(this.rules);
  }
}
