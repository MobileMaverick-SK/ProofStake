import type { ProofRules, Verdict } from '../shared';

export interface ProofVerifier {
  verify(input: { proofUrl: string; rules: ProofRules; challengeCode: string }): Promise<Verdict>;
}

export interface VerdictRepository {
  get(goalId: string): Promise<Verdict | null>;
  save(goalId: string, verdict: Verdict): Promise<void>;
}
