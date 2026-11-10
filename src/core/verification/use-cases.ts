import { notFound, verdictSchema, type EventBus, type ProofRules, type Verdict } from '../shared';
import type { ProofVerifier, VerdictRepository } from './ports';

export interface VerificationDeps {
  verifier: ProofVerifier;
  verdicts: VerdictRepository;
  bus: EventBus;
}

/** Used when the verifier fails or answers with nonsense: zero confidence sends the case to a human. */
export function unverifiableVerdict(rules: ProofRules, reason: string): Verdict {
  return {
    outcome: 'FAIL',
    fractionCompleted: 0,
    confidence: 0,
    checks: rules.checks.map((check) => ({ checkId: check.id, passed: false, reason })),
    codeFound: false,
  };
}

/**
 * Rules the model is not trusted to apply by itself:
 * a missing one-time code is always a FAIL, and PASS / FAIL pin the fraction to 1 / 0.
 */
export function normalizeVerdict(verdict: Verdict): Verdict {
  if (!verdict.codeFound) return { ...verdict, outcome: 'FAIL', fractionCompleted: 0 };
  if (verdict.outcome === 'PASS') return { ...verdict, fractionCompleted: 1 };
  if (verdict.outcome === 'FAIL') return { ...verdict, fractionCompleted: 0 };
  return verdict;
}

export function createVerificationUseCases({ verifier, verdicts, bus }: VerificationDeps) {
  return {
    async verifyProof(input: {
      goalId: string;
      proofUrl: string;
      rules: ProofRules;
      challengeCode: string;
    }): Promise<Verdict> {
      let verdict: Verdict;
      try {
        const raw = await verifier.verify({
          proofUrl: input.proofUrl,
          rules: input.rules,
          challengeCode: input.challengeCode,
        });
        verdict = normalizeVerdict(verdictSchema.parse(raw));
      } catch {
        verdict = unverifiableVerdict(input.rules, 'The proof could not be checked automatically.');
      }
      await verdicts.save(input.goalId, verdict);
      await bus.publish({ type: 'VerdictIssued', goalId: input.goalId, verdict });
      return verdict;
    },

    async getVerdict(goalId: string): Promise<Verdict> {
      const verdict = await verdicts.get(goalId);
      if (!verdict) throw notFound('Verdict for goal', goalId);
      return verdict;
    },
  };
}
