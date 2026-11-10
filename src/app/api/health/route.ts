import { NextResponse } from 'next/server';
import { getApp } from '@/composition-root';

export const dynamic = 'force-dynamic';

/** For the hosting platform's health check: confirms the app starts and says which integrations are configured. */
export async function GET() {
  const app = getApp();
  return NextResponse.json({
    ok: true,
    paypal: app.paypalConfigured ? 'sandbox' : 'not configured',
    ai: app.aiConfigured ? 'configured' : 'not configured (verdicts are simulated)',
    webhooks: app.paypalWebhooks.configured ? 'configured' : 'off (no PAYPAL_WEBHOOK_ID)',
    reviewQueue: app.adminGate.enabled ? 'enabled' : 'off (no ADMIN_PASSWORD)',
  });
}
