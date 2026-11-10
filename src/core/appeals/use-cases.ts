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
import type { Refunds, ReviewCase, ReviewRepository } from './ports';

export interface AppealsDeps {
  reviews: ReviewRepository;
  refunds: Refunds;
  bus: EventBus;
  clock: Clock;
}

export function createAppealsUseCases({ reviews, refunds, bus, clock }: AppealsDeps) {
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

    /** The user disputes a capture. One appeal per goal. */
    async fileAppeal(goalId: string, reason: string): Promise<ReviewCase> {
      const text = reason.trim();
      if (text.length < 5 || text.length > 1000) {
        throw new DomainError('VALIDATION', 'Explain the appeal in 5 to 1000 characters');
      }
      if (!(await reviews.getCapture(goalId))) {
        throw new DomainError('CONFLICT', 'Nothing was captured for this goal, so there is nothing to appeal');
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
      return appeal;
    },

    /** Upholding an appeal refunds exactly what was captured. */
    async decideAppeal(caseId: string, uphold: boolean): Promise<ReviewCase> {
      const open = await loadOpen(caseId, 'APPEAL');
      if (!uphold) {
        const rejected: ReviewCase = { ...open, status: 'RESOLVED', resolution: { kind: 'APPEAL_REJECTED' } };
        await reviews.saveCase(rejected);
        return rejected;
      }
      const capture = await reviews.getCapture(open.goalId);
      if (!capture) throw new DomainError('CONFLICT', 'There is no capture to refund');
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
