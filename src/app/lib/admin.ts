import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isHttps } from '@/app/lib/origin';
import { getApp } from '@/composition-root';

const COOKIE = 'proofstake_reviewer';

export async function isReviewer(): Promise<boolean> {
  return getApp().adminGate.check((await cookies()).get(COOKIE)?.value);
}

/** For reviewer-only screens and actions: anyone else is sent to the reviewer sign-in. */
export async function requireReviewer(): Promise<void> {
  if (!(await isReviewer())) redirect('/review/login');
}

export async function setReviewerCookie(token: string): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(await headers()),
    path: '/',
    maxAge: 8 * 60 * 60,
  });
}

export async function clearReviewerCookie(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value ?? null;
  store.delete(COOKIE);
  return token;
}
