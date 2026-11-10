import { MANUAL_VERDICTS, type ManualVerdict } from '@/adapters/ai';
import { ownedGoal } from '@/app/lib/api-auth';
import { messageFor } from '@/app/lib/http';
import { getApp } from '@/composition-root';

/** Receives the proof photo from the upload form, then sends the browser back to the goal. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The address is relative on purpose. Behind a hosting proxy the server sees its own
  // internal address in request.url, and redirecting the browser there shows a blank page.
  const path = `/goals/${encodeURIComponent(id)}`;
  const back = (error?: string) =>
    new Response(null, { status: 303, headers: { Location: error ? `${path}?error=${encodeURIComponent(error)}` : path } });
  try {
    const app = getApp();
    const goal = await ownedGoal(id);
    const form = await request.formData();
    const photo = form.get('photo');
    if (!(photo instanceof File) || photo.size === 0) {
      return back('Choose a photo to upload.');
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
    return back(messageFor(error));
  }
  return back();
}
