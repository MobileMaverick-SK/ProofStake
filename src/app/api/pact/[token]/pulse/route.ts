import { NextResponse } from 'next/server';
import { errorResponse } from '@/app/lib/http';
import { goalPulse } from '@/app/lib/pulse';
import { getApp } from '@/composition-root';

export const dynamic = 'force-dynamic';

/** Tells the holder of a pact invite link whether anything on the pact screen has changed. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const pact = await getApp().pacts.getByToken((await params).token);
    return NextResponse.json(await goalPulse(pact.goalId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
