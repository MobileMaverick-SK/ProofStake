import { NextResponse } from 'next/server';
import { messageFor } from '@/app/lib/http';
import { publicOrigin } from '@/app/lib/origin';
import { currentUser } from '@/app/lib/session';
import { getApp } from '@/composition-root';

/**
 * PayPal sends the user here after they approve (or cancel) saving their
 * account from the Account screen. Nothing in the address is trusted: which
 * request to finish comes from the signed-in user's own pending record.
 */
export async function GET(request: Request) {
  const origin = publicOrigin(request.headers, request.url);
  const back = new URL('/account', origin);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/login', origin), 303);

  const app = getApp();
  if (new URL(request.url).searchParams.get('cancelled') === '1') {
    await app.settlement.cancelSavingMethod(user.id);
    back.searchParams.set('notice', 'No PayPal account was saved.');
    return NextResponse.redirect(back, 303);
  }
  try {
    const { label } = await app.settlement.finishSavingMethod(user.id);
    back.searchParams.set('notice', `Saved${label ? ` ${label}` : ' your PayPal account'}. Holds for new goals now take one tap.`);
  } catch (error) {
    back.searchParams.set('error', messageFor(error));
  }
  return NextResponse.redirect(back, 303);
}
