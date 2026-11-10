import { describe, expect, it } from 'vitest';
import { SqliteApiCallLog, openDatabase } from '../src/adapters/db';
import { InMemoryApiCallLog, PayPalClient, PayPalPayouts, PayPalStakeHolds, resourcesOf, summaryOf, type ApiCall } from '../src/adapters/paypal';
import { usd } from '../src/core/shared';
import { createFakePayPalServer } from './fake-paypal-server';

const GOAL = 'goal_0b8f1c2e-1111-4222-8333-444455556666';

function recordingAdapters() {
  const server = createFakePayPalServer();
  const calls: ApiCall[] = [];
  const client = new PayPalClient({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    baseUrl: 'https://api-m.sandbox.paypal.com',
    fetchFn: server.fetchFn,
    onCall: (call) => calls.push(call),
  });
  return { server, calls, holds: new PayPalStakeHolds(client), payouts: new PayPalPayouts(client) };
}

describe('PayPal API call log', () => {
  it('records every call with its endpoint, status, answer and the ids it was about', async () => {
    const { server, calls, holds } = recordingAdapters();
    const { orderId } = await holds.createHold({ goalId: GOAL, amount: usd(2000) });
    server.approve(orderId);
    const { authorizationId } = await holds.confirmHold(orderId);
    const { captureId } = await holds.capture(authorizationId, usd(500));

    const paths = calls.map((call) => `${call.method} ${call.path}`);
    expect(paths[0]).toBe('POST /v2/checkout/orders');
    expect(paths).toContain(`POST /v2/checkout/orders/${orderId}/authorize`);
    expect(paths).toContain(`POST /v2/payments/authorizations/${authorizationId}/capture`);
    expect(paths.some((path) => path.includes('oauth2'))).toBe(false);

    expect(calls[0]!.resources).toEqual(expect.arrayContaining([GOAL, orderId]));
    const authorize = calls.find((call) => call.path.endsWith('/authorize'))!;
    expect(authorize).toMatchObject({ status: 201, result: 'CREATED', amount: '20.00 USD' });
    expect(authorize.resources).toEqual(expect.arrayContaining([orderId, authorizationId]));
    expect(authorize.requestId).toBe(`proofstake-authorize-${orderId}`);
    const capture = calls.find((call) => call.path.endsWith('/capture'))!;
    expect(capture).toMatchObject({ status: 201, result: 'COMPLETED', amount: '5.00 USD' });
    expect(capture.resources).toEqual(expect.arrayContaining([authorizationId, captureId]));
  });

  it('keeps no credentials, tokens or request bodies', async () => {
    const { server, calls, holds } = recordingAdapters();
    const { orderId } = await holds.createHold({ goalId: GOAL, amount: usd(2000) });
    server.approve(orderId);
    await holds.confirmHold(orderId);
    const text = JSON.stringify(calls);
    for (const secret of ['test-secret', 'test-client', 'Bearer', 'token-', 'buyer@example.test', 'purchase_units']) {
      expect(text).not.toContain(secret);
    }
  });

  it('links a payout to its goal, and records PayPal errors with their debug id', async () => {
    const { calls, payouts, holds } = recordingAdapters();
    const { payoutId } = await payouts.send({ goalId: GOAL, amount: usd(500), recipientEmail: 'ravi@example.test', note: 'Pact' });
    expect(calls.at(-1)!.resources).toEqual(expect.arrayContaining([GOAL, payoutId]));
    await expect(holds.confirmHold('UNKNOWNORDER12345')).rejects.toBeTruthy();
    expect(calls.at(-1)!.status).toBeGreaterThanOrEqual(400);
  });

  it('a recorder that throws never breaks a payment', async () => {
    const server = createFakePayPalServer();
    const client = new PayPalClient({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      baseUrl: 'https://api-m.sandbox.paypal.com',
      fetchFn: server.fetchFn,
      onCall: () => {
        throw new Error('disk full');
      },
    });
    await expect(new PayPalStakeHolds(client).createHold({ goalId: GOAL, amount: usd(2000) })).resolves.toHaveProperty('orderId');
  });

  it('finds calls by any id they were about, on both stores', async () => {
    for (const log of [new InMemoryApiCallLog(), new SqliteApiCallLog(openDatabase(':memory:'))]) {
      const base = { method: 'POST' as const, status: 201, ms: 10 };
      await log.record({ ...base, at: new Date('2026-11-10T09:00:00Z'), path: '/a', resources: [GOAL, 'ORDER1234567'] });
      await log.record({ ...base, at: new Date('2026-11-10T09:01:00Z'), path: '/b', resources: ['ORDER1234567', 'AUTH12345678'] });
      await log.record({ ...base, at: new Date('2026-11-10T09:02:00Z'), path: '/c', resources: ['SOMEONEELSE1'] });
      expect((await log.forResources([GOAL, 'AUTH12345678'])).map((call) => call.path)).toEqual(['/a', '/b']);
      expect(await log.forResources([])).toEqual([]);
    }
  });

  it('reads ids and status from the places PayPal puts them', () => {
    expect(resourcesOf(`/v2/payments/captures/CAP123456789/refund`, `proofstake-refund-CAP123456789`, undefined, { id: 'REF123456789', status: 'COMPLETED' }))
      .toEqual(['CAP123456789', 'REF123456789']);
    expect(summaryOf({ batch_header: { payout_batch_id: 'B1', batch_status: 'PENDING' } })).toEqual({ result: 'PENDING', amount: undefined });
    expect(summaryOf({ name: 'UNPROCESSABLE_ENTITY' }).result).toBe('UNPROCESSABLE_ENTITY');
  });
});
