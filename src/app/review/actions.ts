'use server';

import { redirect } from 'next/navigation';
import { clearReviewerCookie, requireReviewer, setReviewerCookie } from '@/app/lib/admin';
import { messageFor } from '@/app/lib/http';
import { getApp } from '@/composition-root';
import { DomainError, isDomainError, type ReviewDecision } from '@/core/shared';

/** A record that may not exist is simply left out of the case file. */
async function orNull<T>(load: Promise<T>): Promise<T | null> {
  try {
    return await load;
  } catch (error) {
    if (isDomainError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

const withError = (path: string, error: unknown) => `${path}?error=${encodeURIComponent(messageFor(error))}`;
const withNotice = (notice: string) => `/review?notice=${encodeURIComponent(notice)}`;

export async function reviewerLoginAction(form: FormData): Promise<void> {
  const gate = getApp().adminGate;
  const token = gate.login(String(form.get('password') ?? ''));
  if (!token) redirect(withError('/review/login', new DomainError('UNAUTHENTICATED', 'That password is not correct.')));
  await setReviewerCookie(token);
  redirect('/review');
}

export async function reviewerLogoutAction(): Promise<void> {
  const token = await clearReviewerCookie();
  if (token) getApp().adminGate.logout(token);
  redirect('/');
}

const DECISIONS: Record<string, ReviewDecision> = {
  PASS: { outcome: 'PASS', fractionCompleted: 1 },
  PARTIAL_75: { outcome: 'PARTIAL', fractionCompleted: 0.75 },
  PARTIAL_50: { outcome: 'PARTIAL', fractionCompleted: 0.5 },
  PARTIAL_25: { outcome: 'PARTIAL', fractionCompleted: 0.25 },
  FAIL: { outcome: 'FAIL', fractionCompleted: 0 },
};

/** A reviewer decides an unsure verdict. Settlement turns the decision into money. */
export async function resolveReviewAction(caseId: string, form: FormData): Promise<void> {
  await requireReviewer();
  let destination = withNotice('Decision recorded. The money is being settled.');
  try {
    const decision = DECISIONS[String(form.get('decision') ?? '')];
    if (!decision) throw new DomainError('VALIDATION', 'Choose a decision first.');
    await getApp().appeals.resolveReview(caseId, decision);
  } catch (error) {
    destination = withError('/review', error);
  }
  redirect(destination);
}

/** A reviewer upholds an appeal (refunding the charge through PayPal) or rejects it. */
export async function decideAppealAction(caseId: string, uphold: boolean): Promise<void> {
  await requireReviewer();
  let destination = withNotice(uphold ? 'Appeal upheld. The charge was refunded.' : 'Appeal rejected. The charge stands.');
  try {
    await getApp().appeals.decideAppeal(caseId, uphold);
  } catch (error) {
    destination = withError('/review', error);
  }
  redirect(destination);
}

/**
 * Asks the case agent to investigate one open case. The agent reads the case
 * and looks the payment up at PayPal; it changes nothing, and the reviewer still decides.
 */
export async function askCaseAgentAction(caseId: string): Promise<void> {
  await requireReviewer();
  let destination = `/review?notice=${encodeURIComponent('The case agent has reported.')}#case-${caseId}`;
  try {
    const app = getApp();
    const reviewCase = (await app.appeals.listCases({ status: 'OPEN' })).find((open) => open.id === caseId);
    if (!reviewCase) throw new DomainError('CONFLICT', 'This case was already resolved');
    const id = reviewCase.goalId;
    const [goal, rules, slot, verdict, stake, capture] = await Promise.all([
      app.goals.getGoal(id),
      orNull(app.proofRules.getRules(id)),
      orNull(app.proofIntake.getProofSlot(id)),
      orNull(app.verification.getVerdict(id)),
      orNull(app.settlement.getStake(id)),
      app.appeals.getCapture(id),
    ]);
    await app.appeals.requestAdvice(caseId, {
      kind: reviewCase.kind,
      goalText: goal.text,
      deadline: goal.deadline,
      stake: goal.stake,
      rules: rules?.rules,
      verdict: reviewCase.verdict ?? verdict ?? undefined,
      challengeCode: slot?.challengeCode,
      proofUrl: slot?.proof?.url,
      proofSubmittedAt: slot?.proof?.submittedAt,
      appealReason: reviewCase.appealReason,
      payment: {
        orderId: stake?.orderId,
        authorizationId: stake?.authorizationId,
        captureId: capture?.captureId ?? stake?.captureId,
        capturedAmount: capture?.amount ?? stake?.capturedAmount,
        holdStatus: stake?.holdStatus,
      },
    });
  } catch (error) {
    destination = withError('/review', error);
  }
  redirect(destination);
}
