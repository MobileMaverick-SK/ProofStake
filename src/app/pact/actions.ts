'use server';

import { redirect } from 'next/navigation';
import { messageFor } from '@/app/lib/http';
import { getApp } from '@/composition-root';
import { DomainError } from '@/core/shared';

/**
 * What a pact partner can do from their invite link. The link itself is the
 * permission: there is no account. None of these can change a verdict or an amount.
 */
async function run(token: string, notice: string, work: () => Promise<unknown>): Promise<never> {
  let destination = `/pact/${encodeURIComponent(token)}`;
  try {
    await work();
    destination += `?notice=${encodeURIComponent(notice)}`;
  } catch (error) {
    destination += `?error=${encodeURIComponent(messageFor(error))}`;
  }
  redirect(destination);
}

export async function acceptPactAction(token: string, form: FormData): Promise<void> {
  await run(token, 'Pact accepted.', async () => {
    if (form.get('agree') !== 'on') throw new DomainError('VALIDATION', 'Tick the box to agree to the pact.');
    await getApp().pacts.accept(token, String(form.get('payoutEmail') ?? ''));
  });
}

export async function declinePactAction(token: string): Promise<void> {
  await run(token, 'You declined the pact.', () => getApp().pacts.decline(token));
}

export async function nudgePactAction(token: string, form: FormData): Promise<void> {
  await run(token, 'Message sent.', () => getApp().pacts.nudge(token, String(form.get('message') ?? '')));
}
