import type { Money, ProofRules, ReviewDecision, Verdict } from '../shared';

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
  /** What the case agent found and suggests. Advice only: a reviewer still decides. */
  advice?: CaseAdvice;
}

/** Everything known about a case, gathered for the case agent. */
export interface CaseBrief {
  kind: ReviewCase['kind'];
  goalText: string;
  deadline: Date;
  stake: Money;
  rules?: ProofRules;
  /** the automatic check's verdict */
  verdict?: Verdict;
  challengeCode?: string;
  proofUrl?: string;
  proofSubmittedAt?: Date;
  appealReason?: string;
  /** our own record of the payment, for the agent to compare with what PayPal says */
  payment: {
    orderId?: string;
    authorizationId?: string;
    captureId?: string;
    capturedAmount?: Money;
    holdStatus?: string;
  };
}

export const RECOMMENDATIONS = ['PASS', 'PARTIAL', 'FAIL', 'UPHOLD', 'REJECT', 'UNSURE'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export interface CaseAdvice {
  /** PASS, PARTIAL or FAIL for an unsure verdict; UPHOLD or REJECT for an appeal; UNSURE for either */
  recommendation: Recommendation;
  confidence: number;
  summary: string;
  reasons: string[];
  /** what the agent looked up, in order */
  steps: { tool: string; ok: boolean; note: string }[];
  model: string;
  at: Date;
}

/**
 * An AI agent that investigates a case and suggests a decision. It can look
 * things up; it has no way to move money, and its answer is never acted on by code.
 */
export interface CaseAdvisor {
  advise(brief: CaseBrief): Promise<Omit<CaseAdvice, 'at'>>;
}

/** What was captured for a goal, remembered so an appeal can refund it. */
export interface CaptureRecord {
  goalId: string;
  captureId: string;
  amount: Money;
  /** the money was passed on to a pact partner, so it can no longer be refunded */
  paidOut?: boolean;
}

export interface ReviewRepository {
  getCase(caseId: string): Promise<ReviewCase | null>;
  saveCase(reviewCase: ReviewCase): Promise<void>;
  listCases(filter?: { status?: ReviewCase['status']; goalId?: string }): Promise<ReviewCase[]>;
  getCapture(goalId: string): Promise<CaptureRecord | null>;
  saveCapture(capture: CaptureRecord): Promise<void>;
}
