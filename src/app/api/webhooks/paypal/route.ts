import { getApp } from '@/composition-root';

export const dynamic = 'force-dynamic';

/** PayPal calls this when a payment changes. The receiver verifies the signature before anything else. */
export async function POST(request: Request) {
  const status = await getApp().paypalWebhooks.receive({ headers: request.headers, rawBody: await request.text() });
  return new Response(null, { status });
}
