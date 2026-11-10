import { NextResponse } from 'next/server';
import { ownedGoal } from '@/app/lib/api-auth';
import { errorResponse } from '@/app/lib/http';
import { goalPulse } from '@/app/lib/pulse';

export const dynamic = 'force-dynamic';

/** Tells the goal's owner whether anything on the goal screen has changed. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const goal = await ownedGoal((await params).id);
    return NextResponse.json(await goalPulse(goal.id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
