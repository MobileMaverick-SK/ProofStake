import type { ProofRules } from '../shared';

export interface ProofStore {
  save(file: Buffer, mimeType: string): Promise<{ url: string }>;
}

/** Everything proof-intake knows about one goal, built up from events. */
export interface ProofSlot {
  goalId: string;
  deadline: Date;
  challengeCode: string;
  rules?: ProofRules;
  /** how many photos have been uploaded so far */
  attempts?: number;
  /** OPEN only between "stake held" and settlement or the deadline */
  status: 'NOT_OPEN' | 'OPEN' | 'SUBMITTED' | 'CLOSED';
  proof?: { proofId: string; url: string; mimeType: string; submittedAt: Date };
}

export interface ProofRepository {
  get(goalId: string): Promise<ProofSlot | null>;
  save(slot: ProofSlot): Promise<void>;
}
