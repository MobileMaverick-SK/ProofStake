import { describe, expect, it } from 'vitest';
import { InMemoryWebhookEventLog, PayPalClient, PayPalWebhookReceiver } from '../src/adapters/paypal';
import { createFakePayPalServer } from './fake-paypal-server';
import { setup } from './helpers';

const HEADERS: Record<string, string> = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
  'paypal-transmission-id': 'tx-1',
  'paypal-transmission-sig': 'genuine',
  'paypal-transmission-time': '2026-11-10T09:00:00Z',
};
const headers = (overrides: Record<string, string | null> = {}) => {
  const all: Record<string, string | null> = { ...HEADERS, ...overrides };
  return { get: (name: string) => all[name.toLowerCase()] ?? null };
};

function makeReceiver(webhookId = 'WH-TEST') {
  const server = createFakePayPalServer();
  const sent: string[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    if (String(input).endsWith('/verify-webhook-signature')) sent.push(String(init?.body));
    return server.fetchFn(input, init);
  };
  const client = new PayPalClient({ clientId: 'test-client', clientSecret: 'test-secret', baseUrl: 'https://api-m.sandbox.paypal.com', fetchFn });
  const calls: string[] = [];
  const log = new InMemoryWebhookEventLog();
  const reactions = {
    holdChanged: async (id: string) => (calls.push(`hold ${id}`), 'synced'),
    payoutChanged: async (id: string) => (calls.push(`payout ${id}`), 'synced'),
  };
  return { receiver: new PayPalWebhookReceiver(client, webhookId, log, reactions), calls, log, sent, reactions };
}

const event = (type: string, resource: object, id = 'WH-EVENT-1') => JSON.stringify({ id, event_type: type, resource });

describe('PayPal webhooks', () => {
  it('verifies the signature with PayPal, sending the event back byte for byte', async () => {
    const { receiver, calls, sent } = makeReceiver();
    // Spacing and a float that JSON.parse/stringify would rewrite.
    const raw = '{"id":"WH-EVENT-1",  "event_type":"PAYMENT.AUTHORIZATION.VOIDED","resource":{"id":"AUTH1","amount":{"value":20.00}}}';
    expect(await receiver.receive({ headers: headers(), rawBody: raw })).toBe(200);
    expect(calls).toEqual(['hold AUTH1']);
    expect(sent[0]).toContain(`"webhook_id":"WH-TEST","webhook_event":${raw}}`);
    expect(JSON.parse(sent[0]!)).toMatchObject({ auth_algo: 'SHA256withRSA', transmission_id: 'tx-1', transmission_sig: 'genuine' });
  });

  it('acts on nothing when the signature is not genuine or a header is missing', async () => {
    const { receiver, calls, log } = makeReceiver();
    const raw = event('PAYMENT.AUTHORIZATION.VOIDED', { id: 'AUTH1' });
    expect(await receiver.receive({ headers: headers({ 'paypal-transmission-sig': 'forged' }), rawBody: raw })).toBe(401);
    expect(await receiver.receive({ headers: headers({ 'paypal-cert-url': null }), rawBody: raw })).toBe(400);
    expect(await receiver.receive({ headers: headers(), rawBody: 'not json' })).toBe(400);
    expect(calls).toEqual([]);
    expect(await log.recent(10)).toEqual([]);
  });

  it('is off without a webhook id', async () => {
    const { receiver } = makeReceiver('');
    expect(receiver.configured).toBe(false);
    expect(await receiver.receive({ headers: headers(), rawBody: event('X', {}) })).toBe(503);
  });

  it('handles each event once, and routes captures and payouts to the right place', async () => {
    const { receiver, calls, log } = makeReceiver();
    const voided = event('PAYMENT.AUTHORIZATION.VOIDED', { id: 'AUTH1' }, 'E1');
    await receiver.receive({ headers: headers(), rawBody: voided });
    await receiver.receive({ headers: headers(), rawBody: voided });
    await receiver.receive({ headers: headers(), rawBody: event('PAYMENT.CAPTURE.COMPLETED', { id: 'CAP1', supplementary_data: { related_ids: { authorization_id: 'AUTH2' } } }, 'E2') });
    await receiver.receive({ headers: headers(), rawBody: event('PAYMENT.PAYOUTS-ITEM.SUCCEEDED', { payout_batch_id: 'BATCH1' }, 'E3') });
    await receiver.receive({ headers: headers(), rawBody: event('PAYMENT.PAYOUTSBATCH.SUCCESS', { batch_header: { payout_batch_id: 'BATCH2' } }, 'E4') });
    await receiver.receive({ headers: headers(), rawBody: event('PAYMENT.CAPTURE.REFUNDED', { id: 'REF1' }, 'E5') });
    await receiver.receive({ headers: headers(), rawBody: event('BILLING.PLAN.CREATED', { id: 'P1' }, 'E6') });

    expect(calls).toEqual(['hold AUTH1', 'hold AUTH2', 'payout BATCH1', 'payout BATCH2']);
    const logged = await log.recent(10);
    expect(logged).toHaveLength(6);
    expect(logged.find((entry) => entry.id === 'E6')?.result).toBe('not an event this app acts on');
    expect(logged.find((entry) => entry.id === 'E5')?.result).toBe('noted');
  });

  it('asks PayPal to send the event again when handling it failed', async () => {
    const { receiver, reactions, log } = makeReceiver();
    reactions.holdChanged = async () => {
      throw new Error('database is busy');
    };
    expect(await receiver.receive({ headers: headers(), rawBody: event('PAYMENT.AUTHORIZATION.VOIDED', { id: 'AUTH1' }) })).toBe(500);
    expect(await log.recent(10)).toEqual([]);
  });
});

describe('a hold that changes at PayPal', () => {
  it('voided outside the app: the stake is released, the goal closes, and nothing can be charged later', async () => {
    const { app, ports, activeGoal, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000, 1);
    ports.stakeHolds.voidAtProvider(authorizationId);

    expect(await app.settlement.syncHold(authorizationId)).toBe('RELEASED');
    expect(await stateOf(goalId)).toBe('SETTLED_RELEASED');
    expect(await app.settlement.getStake(goalId)).toMatchObject({ status: 'RELEASED', holdStatus: 'VOIDED', endedAtProvider: true });

    ports.clock.advance(2 * 60 * 60 * 1000);
    await app.goals.tickDeadlines();
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(0);
    expect(ports.handlerErrors).toEqual([]);
  });

  it('an event about a healthy hold changes nothing but the record of it', async () => {
    const { app, activeGoal, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal();
    expect(await app.settlement.syncHold(authorizationId)).toBe('UNCHANGED');
    expect(await stateOf(goalId)).toBe('ACTIVE');
    expect((await app.settlement.getStake(goalId)).providerNotifiedAt).toBeInstanceOf(Date);
    expect(await app.settlement.syncHold('SOMEONE-ELSES-AUTH')).toBe('UNKNOWN_HOLD');
  });

  it('an event about our own capture does not settle anything twice', async () => {
    const { app, ports, activeGoal, submitFinal, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000);
    ports.proofVerifier.respondWith({ outcome: 'FAIL', fractionCompleted: 0 });
    await submitFinal(goalId);
    expect(await app.settlement.syncHold(authorizationId)).toBe('UNCHANGED');
    expect(await stateOf(goalId)).toBe('SETTLED_FORFEITED');
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(2000);
  });

  it('a payout event refreshes the payout status at once', async () => {
    const { app, ports } = setup();
    expect(await app.pacts.refreshPayout('NOPE')).toBe('UNKNOWN_PAYOUT');
    expect(ports.payouts.sent).toEqual([]);
  });
});

describe('webhook storage on SQLite', () => {
  it('finds a stake by its authorization and keeps the event log', async () => {
    const { BACKENDS } = await import('./helpers');
    const { SqliteWebhookEventLog, openDatabase } = await import('../src/adapters/db');
    const { app, ports, activeGoal } = setup({}, BACKENDS[1]);
    const { goalId, authorizationId } = await activeGoal();
    ports.stakeHolds.voidAtProvider(authorizationId);
    expect(await app.settlement.syncHold(authorizationId)).toBe('RELEASED');
    expect((await app.settlement.getStake(goalId)).status).toBe('RELEASED');

    const log = new SqliteWebhookEventLog(openDatabase(':memory:'));
    await log.record({ id: 'E1', type: 'A', receivedAt: new Date('2026-11-10T09:00:00Z'), result: 'x' });
    await log.record({ id: 'E2', type: 'B', resourceId: 'R', receivedAt: new Date('2026-11-10T10:00:00Z'), result: 'y' });
    expect(await log.has('E1')).toBe(true);
    expect(await log.has('E9')).toBe(false);
    expect((await log.recent(1)).map((entry) => entry.id)).toEqual(['E2']);
  });
});
