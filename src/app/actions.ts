'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { FormState } from '@/app/lib/form-state';
import { messageFor } from '@/app/lib/http';
import { publicOrigin } from '@/app/lib/origin';
import { clearSessionCookie, requireUser, setSessionCookie } from '@/app/lib/session';
import { getApp } from '@/composition-root';
import { validatePartner } from '@/core/pacts';
import { DomainError, fromDecimalString } from '@/core/shared';

const withError = (path: string, error: unknown) => `${path}?error=${encodeURIComponent(messageFor(error))}`;

export async function signupAction(_previous: FormState, form: FormData): Promise<FormState> {
  const name = String(form.get('name') ?? '');
  const email = String(form.get('email') ?? '');
  try {
    const { token, expiresAt } = await getApp().accounts.register({ name, email, password: String(form.get('password') ?? '') });
    await setSessionCookie(token, expiresAt);
  } catch (error) {
    return { error: messageFor(error), values: { name, email } };
  }
  redirect('/');
}

export async function loginAction(_previous: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '');
  try {
    const { token, expiresAt } = await getApp().accounts.login({ email, password: String(form.get('password') ?? '') });
    await setSessionCookie(token, expiresAt);
  } catch (error) {
    return { error: messageFor(error), values: { email } };
  }
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  const token = await clearSessionCookie();
  if (token) await getApp().accounts.logout(token);
  redirect('/');
}

export async function createGoalAction(_previous: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const text = String(form.get('text') ?? '');
  const stake = String(form.get('stake') ?? '');
  let goalId: string;
  try {
    // Either a preset ("due in N minutes") or an exact time the browser converted from the user's time zone.
    const exact = String(form.get('deadlineIso') ?? '');
    const minutes = Number(form.get('minutes'));
    let deadline: Date;
    if (form.get('minutes') === 'custom') {
      deadline = new Date(exact);
      if (!exact || Number.isNaN(deadline.getTime())) {
        throw new DomainError('VALIDATION', 'Pick the date and time the goal is due.');
      }
    } else if (Number.isFinite(minutes) && minutes > 0) {
      deadline = new Date(Date.now() + minutes * 60_000);
    } else {
      throw new DomainError('VALIDATION', 'Choose when the goal is due.');
    }
    let stakeCents: number;
    try {
      stakeCents = fromDecimalString(stake).cents;
    } catch {
      throw new DomainError('VALIDATION', 'Enter the stake as dollars and cents, for example 20 or 20.50.');
    }
    const app = getApp();
    // Check the partner first, so a typo there does not leave a goal behind without its pact.
    const partner =
      form.get('destination') === 'partner'
        ? validatePartner(
            { partnerName: String(form.get('partnerName') ?? ''), partnerEmail: String(form.get('partnerEmail') ?? '') },
            user.email,
          )
        : null;
    const goal = await app.goals.createGoal({ userId: user.id, text, deadline, stakeCents });
    goalId = goal.id;
    if (partner) {
      await app.pacts.propose({
        goalId,
        userId: user.id,
        ownerName: user.name,
        ownerEmail: user.email,
        ...partner,
        goalText: goal.text,
        deadline: goal.deadline,
        stake: goal.stake,
      });
    }
  } catch (error) {
    return { error: messageFor(error), values: { text, stake } };
  }
  redirect(`/goals/${goalId}`);
}

export async function acceptRulesAction(goalId: string): Promise<void> {
  const user = await requireUser();
  let destination = `/goals/${goalId}`;
  try {
    const app = getApp();
    await app.goals.getOwnedGoal(user.id, goalId);
    await app.proofRules.acceptRules(goalId);
  } catch (error) {
    destination = withError(destination, error);
  }
  redirect(destination);
}

export async function regenerateRulesAction(goalId: string): Promise<void> {
  const user = await requireUser();
  let destination = `/goals/${goalId}`;
  try {
    const app = getApp();
    await app.goals.getOwnedGoal(user.id, goalId);
    await app.proofRules.regenerateRules(goalId);
  } catch (error) {
    destination = withError(destination, error);
  }
  redirect(destination);
}

/** The user takes a not-approved proof result as final instead of uploading again. */
export async function acceptResultAction(goalId: string): Promise<void> {
  const user = await requireUser();
  let destination = `/goals/${goalId}`;
  try {
    const app = getApp();
    await app.goals.getOwnedGoal(user.id, goalId);
    await app.settlement.acceptResult(goalId);
  } catch (error) {
    destination = withError(destination, error);
  }
  redirect(destination);
}

/** Tries the unfinished PayPal step for a goal again, right now. */
export async function retrySettlementAction(goalId: string): Promise<void> {
  const user = await requireUser();
  let destination = `/goals/${goalId}`;
  try {
    const app = getApp();
    await app.goals.getOwnedGoal(user.id, goalId);
    await app.settlement.retrySettlement(goalId);
  } catch (error) {
    destination = withError(destination, error);
  }
  redirect(destination);
}

/** The user disputes a charge. A reviewer decides; an upheld appeal is refunded. */
export async function fileAppealAction(goalId: string, form: FormData): Promise<void> {
  const user = await requireUser();
  let destination = `/goals/${goalId}`;
  try {
    const app = getApp();
    await app.goals.getOwnedGoal(user.id, goalId);
    await app.appeals.fileAppeal(goalId, String(form.get('reason') ?? ''));
    destination += `?notice=${encodeURIComponent('Appeal sent. A reviewer will look at it.')}`;
  } catch (error) {
    destination = withError(destination, error);
  }
  redirect(destination);
}

/** One-step hold on the PayPal account the user saved earlier. The amount comes from the stored goal. */
export async function holdWithSavedAction(goalId: string): Promise<void> {
  const user = await requireUser();
  let destination = `/goals/${goalId}`;
  try {
    const app = getApp();
    await app.goals.getOwnedGoal(user.id, goalId);
    await app.settlement.holdWithSavedMethod(goalId);
  } catch (error) {
    destination = withError(destination, error);
  }
  redirect(destination);
}

/** The user removes their saved PayPal account. Holds already placed are not affected. */
export async function forgetSavedMethodAction(): Promise<void> {
  const user = await requireUser();
  await getApp().settlement.forgetSavedMethod(user.id);
  redirect('/account');
}

/** Starts saving a PayPal account from the Account screen: sends the user to PayPal to approve it. */
export async function startSavingMethodAction(): Promise<void> {
  const user = await requireUser();
  let destination: string;
  try {
    const origin = publicOrigin(await headers());
    const { approveUrl } = await getApp().settlement.startSavingMethod(user.id, {
      returnUrl: `${origin}/account/paypal/return`,
      cancelUrl: `${origin}/account/paypal/return?cancelled=1`,
    });
    destination = approveUrl;
  } catch (error) {
    destination = withError('/account', error);
  }
  redirect(destination);
}
