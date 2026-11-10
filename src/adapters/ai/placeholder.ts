/**
 * Stand-ins used until the AI adapter (milestone 3) is configured. They are
 * honest about what they are: the rule writer fills a fixed template, and the
 * "verifier" returns whichever verdict the person testing picked on screen.
 */
import type { RuleWriter } from '../../core/proof-rules';
import type { ProofRules, Verdict } from '../../core/shared';
import type { ProofVerifier } from '../../core/verification';

export class TemplateRuleWriter implements RuleWriter {
  async draftRules(goalText: string): Promise<ProofRules> {
    return {
      checks: [
        { id: 'shows-work', description: `The photo clearly shows the finished work for: "${goalText}"`, required: true },
        { id: 'main-subject', description: 'The work is the main subject of the photo and is readable.', required: true },
        { id: 'code-visible', description: 'Your handwritten one-time code is visible in the same photo.', required: true },
      ],
      partialCompletion: { measurable: true, description: 'The share of the described work that is visibly finished.' },
    };
  }
}

export const MANUAL_VERDICTS = ['PASS', 'PARTIAL_50', 'FAIL', 'UNSURE'] as const;
export type ManualVerdict = (typeof MANUAL_VERDICTS)[number];

export class ManualVerdictVerifier implements ProofVerifier {
  private next: ManualVerdict = 'PASS';

  choose(verdict: ManualVerdict): void {
    this.next = verdict;
  }

  async verify(input: { rules: ProofRules }): Promise<Verdict> {
    const choice = this.next;
    this.next = 'PASS';
    const outcome = choice === 'PASS' ? 'PASS' : choice === 'PARTIAL_50' ? 'PARTIAL' : 'FAIL';
    const fractionCompleted = choice === 'PASS' ? 1 : choice === 'PARTIAL_50' ? 0.5 : 0;
    return {
      outcome,
      fractionCompleted,
      confidence: choice === 'UNSURE' ? 0.4 : 0.95,
      checks: input.rules.checks.map((check) => ({
        checkId: check.id,
        passed: outcome === 'PASS',
        reason: 'Simulated result. The AI check is connected in the next milestone.',
      })),
      codeFound: true,
    };
  }
}
