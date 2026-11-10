import { isReviewer } from '@/app/lib/admin';
import { currentUser } from '@/app/lib/session';
import { getApp } from '@/composition-root';

/** Serves a stored proof photo to signed-in users and reviewers. The store only accepts names it generated itself. */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!(await currentUser()) && !(await isReviewer())) return new Response('Sign in to continue', { status: 401 });
  const stored = await getApp().proofStore.read((await params).name);
  if (!stored) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(stored.file), {
    headers: { 'Content-Type': stored.mimeType, 'Cache-Control': 'private, max-age=3600' },
  });
}
