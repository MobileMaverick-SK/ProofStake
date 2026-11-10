import { NextResponse } from 'next/server';
import { MANUAL_VERDICTS, type ManualVerdict } from '@/adapters/ai';
import { ownedGoal } from '@/app/lib/api-auth';
import { messageFor } from '@/app/lib/http';
import { getApp } from '@/composition-root';

/** Receives the proof photo from the upload form, then sends the browser back to the goal. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = new URL(`/goals/${encodeURIComponent(id)}`, request.url);
  try {
    const app = getApp();
    const goal = await ownedGoal(id);
    const form = await request.formData();
    const photo = form.get('photo');
    if (!(photo instanceof File) || photo.size === 0) {
      back.searchParams.set('error', 'Choose a photo to upload.');
      return NextResponse.redirect(back, 303);
    }
    const simulated = String(form.get('simulatedVerdict') ?? '');
    if (!app.aiConfigured && (MANUAL_VERDICTS as readonly string[]).includes(simulated)) {
      app.manualVerifier.choose(simulated as ManualVerdict);
    }
    await app.proofIntake.submitProof({
      goalId: goal.id,
      file: Buffer.from(await photo.arrayBuffer()),
      mimeType: photo.type,
    });
  } catch (error) {
    back.searchParams.set('error', messageFor(error));
  }
  return NextResponse.redirect(back, 303);
}
