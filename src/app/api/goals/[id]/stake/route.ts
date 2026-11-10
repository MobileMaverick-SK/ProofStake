import { NextResponse } from 'next/server';
import { ownedGoal } from '@/app/lib/api-auth';
import { errorResponse } from '@/app/lib/http';
import { publicOrigin } from '@/app/lib/origin';
import { getApp } from '@/composition-root';

/**
 * Creates the PayPal order for this goal's hold. The amount comes from the
 * stored goal, never from the request. The only thing the browser may say is
 * whether the user wants their PayPal account saved for later holds.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const goal = await ownedGoal((await params).id);
    const body = (await request.json().catch(() => ({}))) as { save?: unknown };
    const { orderId } = await getApp().settlement.startHold(goal.id, {
      saveForLater: body.save === true,
      returnUrl: `${publicOrigin(request.headers, request.url)}/goals/${goal.id}`,
    });
    return NextResponse.json({ orderId });
  } catch (error) {
    return errorResponse(error);
  }
}
