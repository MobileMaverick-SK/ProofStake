import type { ProofRules, Verdict } from '../../core/shared';
import type { ProofVerifier } from '../../core/verification';

type VerifyInput = { proofUrl: string; rules: ProofRules; challengeCode: string };

/** Answers PASS with high confidence unless a test scripts something else. */
export class FakeProofVerifier implements ProofVerifier {
  readonly calls: VerifyInput[] = [];
  private scripted: ((input: VerifyInput) => unknown) | null = null;

  /** The next verdict. Fields left out default to a confident PASS. `checks` default to the rules. */
  respondWith(partial: Partial<Verdict>): void {
    this.scripted = (input) => ({ ...FakeProofVerifier.pass(input.rules), ...partial });
  }

  /** The next call returns this raw value unvalidated, to exercise bad model output. */
  respondWithRaw(value: unknown): void {
    this.scripted = () => value;
  }

  failNext(): void {
    this.scripted = () => {
      throw new Error('fake verifier outage');
    };
  }

  async verify(input: VerifyInput): Promise<Verdict> {
    this.calls.push(input);
    const script = this.scripted;
    this.scripted = null;
    return (script ? script(input) : FakeProofVerifier.pass(input.rules)) as Verdict;
  }

  private static pass(rules: ProofRules): Verdict {
    return {
      outcome: 'PASS',
      fractionCompleted: 1,
      confidence: 0.95,
      checks: rules.checks.map((c) => ({ checkId: c.id, passed: true, reason: 'Looks right.' })),
      codeFound: true,
    };
  }
}
