'use server';

import { redirect } from 'next/navigation';
import { clearReviewerCookie, requireReviewer, setReviewerCookie } from '@/app/lib/admin';
import { messageFor } from '@/app/lib/http';
import { getApp } from '@/composition-root';
import { DomainError, type ReviewDecision } from '@/core/shared';

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
