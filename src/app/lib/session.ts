import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isHttps } from '@/app/lib/origin';
import { getApp } from '@/composition-root';
import type { PublicUser } from '@/core/accounts';

const COOKIE = 'proofstake_session';

/** The signed-in user, or null. Reads the session cookie; the token itself never reaches page code. */
export async function currentUser(): Promise<PublicUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? getApp().accounts.authenticate(token) : null;
}

/** For screens that need an account: sends signed-out visitors to the sign-in page. */
export async function requireUser(): Promise<PublicUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(await headers()),
    path: '/',
    expires: expiresAt,
  });
}

/** Removes the cookie and returns the token it held, so the session can be ended on the server too. */
export async function clearSessionCookie(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value ?? null;
  store.delete(COOKIE);
  return token;
}
