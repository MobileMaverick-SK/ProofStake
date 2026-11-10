import { describe, expect, it, vi } from 'vitest';
import { PayPalClient, PayPalMethodVault, PayPalRefunds, PayPalStakeHolds } from '../src/adapters/paypal';
import { DomainError, usd } from '../src/core/shared';
import { createFakePayPalServer } from './fake-paypal-server';
import { stakeHoldsContract } from './stake-holds.contract';

const SANDBOX = 'https://api-m.sandbox.paypal.com';

const RETURN = 'https://app.example.test/goals/goal_1';
const HOUR_BUCKET = 123;
const FIXED_NOW = HOUR_BUCKET * 3600 * 1000 + 5;

function makeAdapter(overrides: Partial<{ clientId: string; clientSecret: string; now: () => number }> = {}) {
  const server = createFakePayPalServer();
  const client = new PayPalClient({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    baseUrl: SANDBOX,
    fetchFn: server.fetchFn,
    ...overrides,
  });
  return {
    server,
    holds: new PayPalStakeHolds(client, overrides.now ?? (() => FIXED_NOW)),
    refunds: new PayPalRefunds(client),
    vault: new PayPalMethodVault(client),
  };
}

// The PayPal adapter must behave exactly like the fake the core is tested with.
stakeHoldsContract('PayPal adapter (HTTP layer faked)', () => {
  const { server, holds } = makeAdapter();
  return { holds, approve: async (orderId) => server.approve(orderId) };
});

describe('PayPal adapter', () => {
  it('refuses any base URL that is not the PayPal sandbox', () => {
    const make = (baseUrl: string) => new PayPalClient({ clientId: 'a', clientSecret: 'b', baseUrl });
    expect(() => make('https://api-m.paypal.com')).toThrow(/sandbox/);
    expect(() => make('https://api.paypal.com')).toThrow(/sandbox/);
    expect(() => make('http://api-m.sandbox.paypal.com')).toThrow(/sandbox/);
    expect(() => make('https://api-m.sandbox.paypal.com.evil.example')).toThrow(/sandbox/);
    expect(() => make(SANDBOX)).not.toThrow();
  });

  it('creates an AUTHORIZE order with a decimal-string amount and an idempotency key', async () => {
    const { server, holds } = makeAdapter();
    await holds.createHold({ goalId: 'goal_1', amount: usd(2050) });

    const create = server.requests.find((r) => r.path === '/v2/checkout/orders')!;
    expect(create.body).toMatchObject({
      intent: 'AUTHORIZE',
      purchase_units: [{ reference_id: 'goal_1', custom_id: 'goal_1', amount: { currency_code: 'USD', value: '20.50' } }],
    });
    expect(create.headers['PayPal-Request-Id']).toBe(`proofstake-hold-goal_1-2050-${HOUR_BUCKET}`);
    expect(JSON.stringify(create.body)).not.toContain('vault');
  });

  it('captures an explicit amount as the final capture, and sends a request id on every write', async () => {
    const { server, holds, refunds } = makeAdapter();
    const { orderId } = await holds.createHold({ goalId: 'goal_1', amount: usd(2000) });
    server.approve(orderId);
    const { authorizationId, amount } = await holds.confirmHold(orderId);
    expect(amount).toEqual(usd(2000));

    const { captureId } = await holds.capture(authorizationId, usd(1333));
    const capture = server.requests.find((r) => r.path.endsWith('/capture'))!;
    expect(capture.body).toEqual({ amount: { currency_code: 'USD', value: '13.33' }, final_capture: true });

    const { refundId } = await refunds.refund(captureId, usd(1333));
    expect(refundId).toBeTruthy();
    expect(server.requests.find((r) => r.path.endsWith('/refund'))!.body).toEqual({
      amount: { currency_code: 'USD', value: '13.33' },
    });

    const writes = server.requests.filter((r) => r.method === 'POST' && r.path !== '/v1/oauth2/token');
    expect(writes).toHaveLength(4);
    expect(writes.every((r) => r.headers['PayPal-Request-Id']?.startsWith('proofstake-'))).toBe(true);
    expect(new Set(writes.map((r) => r.headers['PayPal-Request-Id'])).size).toBe(4);
  });

  it('caches the access token, renews it when it expires, and recovers from a revoked token', async () => {
    let now = 1_000_000;
    const { server, holds } = makeAdapter({ now: () => now });
    await holds.createHold({ goalId: 'goal_1', amount: usd(500) });
    await holds.createHold({ goalId: 'goal_2', amount: usd(500) });
    expect(server.tokensIssued()).toBe(1);

    now += 3600 * 1000; // past expires_in
    await holds.createHold({ goalId: 'goal_3', amount: usd(500) });
    expect(server.tokensIssued()).toBe(2);

    server.revokeToken();
    await holds.createHold({ goalId: 'goal_4', amount: usd(500) });
    expect(server.tokensIssued()).toBe(3);
  });

  it('an unapproved order is replaced, not replayed, once it is an hour old', async () => {
    let now = FIXED_NOW;
    const { holds } = makeAdapter({ now: () => now });
    const first = await holds.createHold({ goalId: 'goal_1', amount: usd(2000) });
    expect((await holds.createHold({ goalId: 'goal_1', amount: usd(2000) })).orderId).toBe(first.orderId);
    now += 3600 * 1000;
    expect((await holds.createHold({ goalId: 'goal_1', amount: usd(2000) })).orderId).not.toBe(first.orderId);
  });

  it('saves the PayPal account when asked, and later places a hold on it with no buyer step', async () => {
    const { server, holds } = makeAdapter();
    const { orderId } = await holds.createHold({ goalId: 'goal_1', amount: usd(2000), saveForLater: true, returnUrl: RETURN });
    expect(server.requests.find((r) => r.path === '/v2/checkout/orders')!.body).toMatchObject({
      payment_source: {
        paypal: { experience_context: { return_url: RETURN, cancel_url: RETURN }, attributes: { vault: { store_in_vault: 'ON_SUCCESS', usage_type: 'MERCHANT', customer_type: 'CONSUMER' } } },
      },
    });
    server.approve(orderId);
    const confirmed = await holds.confirmHold(orderId);
    expect(confirmed.savedMethod).toEqual({ id: expect.stringMatching(/^VAULT/), label: 'buyer@example.test' });

    const again = await holds.holdWithSavedMethod({ goalId: 'goal_2', amount: usd(1500), savedMethodId: confirmed.savedMethod!.id });
    expect(again.amount).toEqual(usd(1500));
    expect(await holds.getHoldStatus(again.authorizationId)).toBe('HELD');
    const saved = server.requests.filter((r) => r.path === '/v2/checkout/orders').at(-1)!;
    expect(saved.body).toMatchObject({ intent: 'AUTHORIZE', payment_source: { paypal: { vault_id: confirmed.savedMethod!.id } } });
    await holds.capture(again.authorizationId, usd(1500)); // behaves like any other hold afterwards
  });

  it('does not ask PayPal to save the account without a return address, which PayPal requires', async () => {
    const { server, holds } = makeAdapter();
    await holds.createHold({ goalId: 'goal_1', amount: usd(2000), saveForLater: true });
    expect(JSON.stringify(server.requests.at(-1)!.body)).not.toContain('vault');
  });

  it('saves a PayPal account on its own: setup token, buyer approval, payment token', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { server, holds, vault } = makeAdapter();
    const { setupId, approveUrl } = await vault.startSaving({ returnUrl: 'https://app.example.test/back', cancelUrl: 'https://app.example.test/cancel' });
    expect(new URL(approveUrl).hostname).toBe('www.sandbox.paypal.com');
    expect(server.requests.at(-1)!.body).toMatchObject({
      payment_source: {
        paypal: {
          usage_type: 'MERCHANT',
          experience_context: { return_url: 'https://app.example.test/back', cancel_url: 'https://app.example.test/cancel' },
        },
      },
    });

    await expect(vault.finishSaving(setupId)).rejects.toMatchObject({ code: 'PAYMENT_NOT_APPROVED' }); // not approved yet
    server.forgetIdempotency();
    server.approveSetup(setupId);
    const method = await vault.finishSaving(setupId);
    expect(method).toEqual({ id: expect.stringMatching(/^VAULT/), label: 'buyer@example.test' });
    expect(server.requests.at(-1)!.body).toEqual({ payment_source: { token: { id: setupId, type: 'SETUP_TOKEN' } } });

    const hold = await holds.holdWithSavedMethod({ goalId: 'goal_9', amount: usd(2000), savedMethodId: method.id });
    expect(await holds.getHoldStatus(hold.authorizationId)).toBe('HELD');
    log.mockRestore();
  });

  it('an ordinary hold does not report a saved method', async () => {
    const { server, holds } = makeAdapter();
    const { orderId } = await holds.createHold({ goalId: 'goal_1', amount: usd(2000) });
    server.approve(orderId);
    expect((await holds.confirmHold(orderId)).savedMethod).toBeUndefined();
  });

  it('falls back to an ordinary hold when the PayPal app is not enabled for saving accounts', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { server, holds } = makeAdapter();
    server.options.vaultingEnabled = false;
    const { orderId } = await holds.createHold({ goalId: 'goal_1', amount: usd(2000), saveForLater: true, returnUrl: RETURN });
    server.approve(orderId);
    const confirmed = await holds.confirmHold(orderId);
    expect(confirmed.amount).toEqual(usd(2000));
    expect(confirmed.savedMethod).toBeUndefined();
    log.mockRestore();
  });

  it('a saved account PayPal no longer accepts is reported as "approve it yourself"', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { holds } = makeAdapter();
    await expect(
      holds.holdWithSavedMethod({ goalId: 'goal_1', amount: usd(2000), savedMethodId: 'GONE' }),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_APPROVED' });
    log.mockRestore();
  });

  it('recovers the existing hold when authorize is retried after a lost response', async () => {
    const { server, holds } = makeAdapter();
    const { orderId } = await holds.createHold({ goalId: 'goal_1', amount: usd(2000) });
    server.approve(orderId);
    const first = await holds.confirmHold(orderId);
    server.forgetIdempotency(); // PayPal now answers ORDER_ALREADY_AUTHORIZED
    expect(await holds.confirmHold(orderId)).toEqual(first);
  });

  it('maps PayPal errors to domain errors and never leaks the raw response', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { holds } = makeAdapter();
    const { orderId } = await holds.createHold({ goalId: 'goal_1', amount: usd(2000) });

    const notApproved = await holds.confirmHold(orderId).catch((e: unknown) => e);
    expect(notApproved).toBeInstanceOf(DomainError);
    expect(notApproved).toMatchObject({ code: 'PAYMENT_NOT_APPROVED' });
    expect((notApproved as Error).message).not.toMatch(/debug|UNPROCESSABLE|ORDER_NOT_APPROVED/);

    await expect(holds.getHoldStatus('NOPE')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(log).toHaveBeenCalled(); // the detail goes to the server log instead
    log.mockRestore();
  });

  it('reports missing or wrong credentials as a payment failure with a clear message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = makeAdapter({ clientId: '', clientSecret: '' });
    await expect(missing.holds.createHold({ goalId: 'g', amount: usd(500) })).rejects.toMatchObject({
      code: 'PAYMENT_FAILED',
      message: expect.stringContaining('PAYPAL_CLIENT_ID'),
    });
    expect(missing.server.requests).toHaveLength(0);

    const wrong = makeAdapter({ clientSecret: 'wrong' });
    await expect(wrong.holds.createHold({ goalId: 'g', amount: usd(500) })).rejects.toMatchObject({
      code: 'PAYMENT_FAILED',
      message: expect.stringContaining('credentials'),
    });
    log.mockRestore();
  });
});
