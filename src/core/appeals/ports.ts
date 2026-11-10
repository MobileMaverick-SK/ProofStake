import type { Money, ReviewDecision, Verdict } from '../shared';

/** Deliberately separate from StakeHolds: this module can refund, and nothing else. */
export interface Refunds {
  refund(captureId: string, amount: Money): Promise<{ refundId: string }>;
}

export interface ReviewCase {
  id: string;
  goalId: string;
  kind: 'LOW_CONFIDENCE' | 'APPEAL';
  status: 'OPEN' | 'RESOLVED';
  createdAt: Date;
  /** LOW_CONFIDENCE: the verdict the model was unsure about */
  verdict?: Verdict;
  /** APPEAL: what the user wrote */
  appealReason?: string;
  resolution?:
    | { kind: 'REVIEW_DECIDED'; decision: ReviewDecision }
    | { kind: 'APPEAL_UPHELD'; refundId: string; amount: Money }
    | { kind: 'APPEAL_REJECTED' };
}

/** What was captured for a goal, remembered so an appeal can refund it. */
export interface CaptureRecord {
  goalId: string;
  captureId: string;
  amount: Money;
}

export interface ReviewRepository {
  getCase(caseId: string): Promise<ReviewCase | null>;
  saveCase(reviewCase: ReviewCase): Promise<void>;
  listCases(filter?: { status?: ReviewCase['status']; goalId?: string }): Promise<ReviewCase[]>;
  getCapture(goalId: string): Promise<CaptureRecord | null>;
  saveCapture(capture: CaptureRecord): Promise<void>;
}
