import { NextResponse } from 'next/server';
import { ownedGoal } from '@/app/lib/api-auth';
import { errorResponse } from '@/app/lib/http';
import { getApp } from '@/composition-root';

/** Called after the buyer approves in the PayPal popup: authorizes the order and records the hold. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const goal = await ownedGoal((await params).id);
    const stake = await getApp().settlement.confirmHold(goal.id);
    return NextResponse.json({ status: stake.status });
  } catch (error) {
    return errorResponse(error);
  }
}
