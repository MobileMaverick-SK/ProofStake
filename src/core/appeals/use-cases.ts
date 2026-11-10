import {
  DomainError,
  newId,
  notFound,
  reviewDecisionSchema,
  type Clock,
  type EventBus,
  type ReviewDecision,
  type Verdict,
} from '../shared';
import type { CaseAdvisor, CaseBrief, Recommendation, Refunds, ReviewCase, ReviewRepository } from './ports';

const ALLOWED: Record<ReviewCase['kind'], Recommendation[]> = {
  LOW_CONFIDENCE: ['PASS', 'PARTIAL', 'FAIL', 'UNSURE'],
  APPEAL: ['UPHOLD', 'REJECT', 'UNSURE'],
};

export interface AppealsDeps {
  reviews: ReviewRepository;
  refunds: Refunds;
  /** absent when no AI service is configured */
  advisor?: CaseAdvisor;
  bus: EventBus;
  clock: Clock;
}

export function createAppealsUseCases({ reviews, refunds, advisor, bus, clock }: AppealsDeps) {
  async function loadOpen(caseId: string, kind: ReviewCase['kind']): Promise<ReviewCase> {
    const found = await reviews.getCase(caseId);
    if (!found || found.kind !== kind) throw notFound('Review case', caseId);
    if (found.status !== 'OPEN') throw new DomainError('CONFLICT', 'This case was already resolved');
    return found;
  }

  return {
    listCases: (filter?: { status?: ReviewCase['status']; goalId?: string }) => reviews.listCases(filter),

    /** What was charged for a goal, or null if nothing was. */
    getCapture: (goalId: string) => reviews.getCapture(goalId),

    async openLowConfidenceCase(goalId: string, verdict: Verdict): Promise<void> {
      await reviews.saveCase({
        id: newId('case'),
        goalId,
        kind: 'LOW_CONFIDENCE',
        status: 'OPEN',
        createdAt: clock.now(),
        verdict,
      });
    },

    /** A reviewer decides a low-confidence case. Settlement turns the decision into money. */
    async resolveReview(caseId: string, decision: ReviewDecision): Promise<ReviewCase> {
      const open = await loadOpen(caseId, 'LOW_CONFIDENCE');
      const parsed = reviewDecisionSchema.safeParse(decision);
      if (!parsed.success) throw new DomainError('VALIDATION', 'Invalid review decision');
      const resolved: ReviewCase = {
        ...open,
        status: 'RESOLVED',
        resolution: { kind: 'REVIEW_DECIDED', decision: parsed.data },
      };
      await reviews.saveCase(resolved);
      await bus.publish({ type: 'ReviewResolved', goalId: open.goalId, decision: parsed.data });
      return resolved;
    },

    /**
     * Asks the case agent to investigate an open case and stores what it suggests.
     * This changes nothing but the note on the case: the reviewer still decides.
     */
    async requestAdvice(caseId: string, brief: CaseBrief): Promise<ReviewCase> {
      const found = await reviews.getCase(caseId);
      if (!found) throw notFound('Review case', caseId);
      if (found.status !== 'OPEN') throw new DomainError('CONFLICT', 'This case was already resolved');
      if (!advisor) throw new DomainError('CONFLICT', 'The case agent needs an AI key (AI_API_KEY) on the server');
      const advice = await advisor.advise({ ...brief, kind: found.kind });
      const advised: ReviewCase = {
        ...found,
        advice: {
          ...advice,
          // A suggestion that does not fit this kind of case is no suggestion.
          recommendation: ALLOWED[found.kind].includes(advice.recommendation) ? advice.recommendation : 'UNSURE',
          confidence: Math.min(1, Math.max(0, advice.confidence)),
          at: clock.now(),
        },
      };
      // The case may have been decided while the agent was working; do not reopen it.
      const latest = await reviews.getCase(caseId);
      if (latest?.status !== 'OPEN') return latest ?? advised;
      await reviews.saveCase(advised);
      return advised;
    },

    /** The user disputes a capture. One appeal per goal. */
    async fileAppeal(goalId: string, reason: string): Promise<ReviewCase> {
      const text = reason.trim();
      if (text.length < 5 || text.length > 1000) {
        throw new DomainError('VALIDATION', 'Explain the appeal in 5 to 1000 characters');
      }
      const capture = await reviews.getCapture(goalId);
      if (!capture) {
        throw new DomainError('CONFLICT', 'Nothing was captured for this goal, so there is nothing to appeal');
      }
      if (capture.paidOut) {
        throw new DomainError('CONFLICT', 'The time to appeal has passed: the money was already sent to your pact partner');
      }
      const existing = await reviews.listCases({ goalId });
      if (existing.some((c) => c.kind === 'APPEAL')) {
        throw new DomainError('CONFLICT', 'An appeal was already filed for this goal');
      }
      const appeal: ReviewCase = {
        id: newId('case'),
        goalId,
        kind: 'APPEAL',
        status: 'OPEN',
        createdAt: clock.now(),
        appealReason: text,
      };
      await reviews.saveCase(appeal);
      await bus.publish({ type: 'AppealFiled', goalId });
      return appeal;
    },

    /** Upholding an appeal refunds exactly what was captured. */
    async decideAppeal(caseId: string, uphold: boolean): Promise<ReviewCase> {
      const open = await loadOpen(caseId, 'APPEAL');
      if (!uphold) {
        const rejected: ReviewCase = { ...open, status: 'RESOLVED', resolution: { kind: 'APPEAL_REJECTED' } };
        await reviews.saveCase(rejected);
        await bus.publish({ type: 'AppealRejected', goalId: open.goalId });
        return rejected;
      }
      const capture = await reviews.getCapture(open.goalId);
      if (!capture) throw new DomainError('CONFLICT', 'There is no capture to refund');
      if (capture.paidOut) throw new DomainError('CONFLICT', 'This money was already sent to the pact partner and cannot be refunded');
      const { refundId } = await refunds.refund(capture.captureId, capture.amount);
      const upheld: ReviewCase = {
        ...open,
        status: 'RESOLVED',
        resolution: { kind: 'APPEAL_UPHELD', refundId, amount: capture.amount },
      };
      await reviews.saveCase(upheld);
      await bus.publish({ type: 'AppealUpheld', goalId: open.goalId, refundId, amount: capture.amount });
      return upheld;
    },
  };
}
