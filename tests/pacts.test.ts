import { describe, expect, it } from 'vitest';
import { PayPalClient, PayPalPayouts, toPayoutStatus } from '../src/adapters/paypal';
import { usd } from '../src/core/shared';
import { createFakePayPalServer } from './fake-paypal-server';
import { BACKENDS, HOUR, USER, setup as baseSetup } from './helpers';

const MINUTE = 60 * 1000;

describe.each(BACKENDS)('pacts on $name', (backend) => {
  /** An active goal with a pact, and the partner's invite link token. */
  async function withPact(options: { accept?: boolean } = {}) {
    const context = baseSetup({}, backend);
    const { app, ports } = context;
    const goal = await app.goals.createGoal({
      userId: USER,
      text: 'Finish chapter 3 notes',
      deadline: new Date(ports.clock.now().getTime() + 24 * HOUR),
      stakeCents: 2000,
    });
    const pact = await app.pacts.propose({
      goalId: goal.id,
      userId: USER,
      ownerName: 'Asha',
      ownerEmail: 'asha@example.test',
      partnerName: 'Ravi',
      partnerEmail: 'Ravi@Example.test',
      goalText: goal.text,
      deadline: goal.deadline,
      stake: goal.stake,
    });
    await app.proofRules.acceptRules(goal.id);
    const { orderId } = await app.settlement.startHold(goal.id);
    ports.stakeHolds.approve(orderId);
    await app.settlement.confirmHold(goal.id);
    if (options.accept !== false) await app.pacts.accept(pact.token, 'ravi-paypal@example.test');
    const fail = async () => {
      ports.proofVerifier.respondWith({ outcome: 'FAIL', fractionCompleted: 0 });
      await context.submitFinal(goal.id);
    };
    return { ...context, goalId: goal.id, token: pact.token, fail };
  }

  it('the partner sees the goal and its rules, and the pact follows the hold', async () => {
    const { app, goalId, token } = await withPact({ accept: false });
    const pact = await app.pacts.getByToken(token);
    expect(pact).toMatchObject({ goalId, partnerEmail: 'ravi@example.test', status: 'INVITED', outcome: 'HELD', stake: usd(2000) });
    expect(pact.rules?.checks.length).toBeGreaterThan(0);
    await expect(app.pacts.getByToken('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a missed goal is paid to the partner, but only after the appeal window', async () => {
    const { app, ports, goalId, fail } = await withPact();
    await fail();
    expect((await app.pacts.getForGoal(goalId))?.payout).toMatchObject({ status: 'SCHEDULED', amount: usd(2000) });

    await app.pacts.processPayouts();
    expect(ports.payouts.sent).toEqual([]);

    ports.clock.advance(app.pacts.appealWindowMs + MINUTE);
    await app.pacts.processPayouts();
    await app.pacts.processPayouts();
    expect(ports.payouts.sent).toEqual([
      { payoutId: 'FAKE-PAYOUT-1', goalId, amount: usd(2000), recipientEmail: 'ravi-paypal@example.test' },
    ]);
    expect((await app.pacts.getForGoal(goalId))?.payout).toMatchObject({ status: 'SENT', payoutId: 'FAKE-PAYOUT-1', providerStatus: 'PAID' });
    expect(ports.handlerErrors).toEqual([]);
  });

  it('a partly met goal pays the partner only what was captured', async () => {
    const { app, ports, goalId, submitFinal } = await withPact();
    ports.proofVerifier.respondWith({ outcome: 'PARTIAL', fractionCompleted: 0.75 });
    await submitFinal(goalId);
    ports.clock.advance(app.pacts.appealWindowMs + MINUTE);
    await app.pacts.processPayouts();
    expect(ports.payouts.sent.map((p) => p.amount)).toEqual([usd(500)]);
  });

  it('a met goal pays nobody', async () => {
    const { app, ports, goalId, submitFinal } = await withPact();
    ports.proofVerifier.respondWith({ outcome: 'PASS', fractionCompleted: 1 });
    await submitFinal(goalId);
    ports.clock.advance(HOUR);
    await app.pacts.processPayouts();
    expect(ports.payouts.sent).toEqual([]);
    expect(await app.pacts.getForGoal(goalId)).toMatchObject({ outcome: 'KEPT' });
  });

  it('without an accepted pact the money stays in the charity pool', async () => {
    const { app, ports, goalId, token, fail } = await withPact({ accept: false });
    await fail();
    ports.clock.advance(HOUR);
    await app.pacts.processPayouts();
    expect(ports.payouts.sent).toEqual([]);
    expect((await app.pacts.getForGoal(goalId))?.payout).toBeUndefined();
    await expect(app.pacts.accept(token, 'late@example.test')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('an open appeal holds the payout; an upheld one refunds the user and cancels it', async () => {
    const { app, ports, goalId, fail } = await withPact();
    await fail();
    const appeal = await app.appeals.fileAppeal(goalId, 'The photo was cut off.');
    ports.clock.advance(HOUR);
    await app.pacts.processPayouts();
    expect(ports.payouts.sent).toEqual([]);
    expect((await app.pacts.getForGoal(goalId))?.payout?.status).toBe('ON_HOLD');

    await app.appeals.decideAppeal(appeal.id, true);
    await app.pacts.processPayouts();
    expect(ports.payouts.sent).toEqual([]);
    expect(ports.refunds.issued).toHaveLength(1);
    expect(await app.pacts.getForGoal(goalId)).toMatchObject({ outcome: 'REFUNDED', payout: { status: 'CANCELLED' } });
  });

  it('a rejected appeal lets the payout go ahead', async () => {
    const { app, ports, goalId, fail } = await withPact();
    await fail();
    const appeal = await app.appeals.fileAppeal(goalId, 'I was ill that day.');
    ports.clock.advance(HOUR);
    await app.appeals.decideAppeal(appeal.id, false);
    await app.pacts.processPayouts();
    expect(ports.payouts.sent).toHaveLength(1);
  });

  it('once the partner is paid, the charge can no longer be appealed', async () => {
    const { app, ports, goalId, fail } = await withPact();
    await fail();
    ports.clock.advance(HOUR);
    await app.pacts.processPayouts();
    await expect(app.appeals.fileAppeal(goalId, 'Too late, but trying.')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(ports.refunds.issued).toEqual([]);
  });

  it('a failed payout is retried and pays once', async () => {
    const { app, ports, goalId, fail } = await withPact();
    await fail();
    ports.clock.advance(HOUR);
    ports.payouts.failNextSends = 1;
    await app.pacts.processPayouts();
    expect((await app.pacts.getForGoal(goalId))?.payout).toMatchObject({ status: 'SCHEDULED', lastError: { message: 'The payout could not be sent' } });
    await app.pacts.processPayouts();
    await app.pacts.processPayouts();
    expect(ports.payouts.sent).toHaveLength(1);
    expect((await app.pacts.getForGoal(goalId))?.payout?.lastError).toBeUndefined();
  });

  it('the partner can decline, or send one short message after accepting', async () => {
    const declined = await withPact({ accept: false });
    await declined.app.pacts.decline(declined.token);
    await expect(declined.app.pacts.decline(declined.token)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(declined.app.pacts.nudge(declined.token, 'Go!')).rejects.toMatchObject({ code: 'CONFLICT' });

    const { app, token, goalId } = await withPact();
    await expect(app.pacts.nudge(token, 'x'.repeat(141))).rejects.toMatchObject({ code: 'VALIDATION' });
    await app.pacts.nudge(token, '  You can do this.  ');
    expect((await app.pacts.getForGoal(goalId))?.nudge?.text).toBe('You can do this.');
    await expect(app.pacts.nudge(token, 'Again')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(app.pacts.accept(token, 'again@example.test')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a partner with a bad email, or the same email as the user, and a second pact', async () => {
    const { app, goalId } = await withPact();
    const base = { goalId: 'goal_other', userId: USER, ownerName: 'Asha', ownerEmail: 'asha@example.test', partnerName: 'Ravi', goalText: 'x', deadline: new Date(), stake: usd(500) };
    await expect(app.pacts.propose({ ...base, partnerEmail: 'not-an-email' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(app.pacts.propose({ ...base, partnerEmail: 'ASHA@example.test' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(app.pacts.propose({ ...base, goalId, partnerEmail: 'ravi@example.test' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('PayPal payouts adapter', () => {
  function makePayouts() {
    const server = createFakePayPalServer();
    const client = new PayPalClient({ clientId: 'test-client', clientSecret: 'test-secret', baseUrl: 'https://api-m.sandbox.paypal.com', fetchFn: server.fetchFn });
    return { server, payouts: new PayPalPayouts(client) };
  }

  it('sends one item to the email address, with the amount as a decimal string', async () => {
    const { server, payouts } = makePayouts();
    const { payoutId } = await payouts.send({ goalId: 'goal_1', amount: usd(1250), recipientEmail: 'ravi@example.test', note: 'Pact' });
    const request = server.requests.find((r) => r.path === '/v1/payments/payouts')!;
    expect(request.headers['PayPal-Request-Id']).toBe('proofstake-payout-goal_1');
    expect(request.body).toMatchObject({
      sender_batch_header: { sender_batch_id: 'proofstake-payout-goal_1' },
      items: [{ recipient_type: 'EMAIL', receiver: 'ravi@example.test', amount: { currency: 'USD', value: '12.50' } }],
    });
    expect(await payouts.getStatus(payoutId)).toBe('PAID');
  });

  it('sending again for the same goal does not pay twice', async () => {
    const { payouts } = makePayouts();
    const input = { goalId: 'goal_1', amount: usd(1250), recipientEmail: 'ravi@example.test', note: 'Pact' };
    expect(await payouts.send(input)).toEqual(await payouts.send(input));
  });

  it('maps PayPal statuses', () => {
    expect(toPayoutStatus('SUCCESS')).toBe('PAID');
    expect(toPayoutStatus('UNCLAIMED')).toBe('UNCLAIMED');
    expect(toPayoutStatus('RETURNED')).toBe('FAILED');
    expect(toPayoutStatus('PENDING')).toBe('PROCESSING');
    expect(toPayoutStatus(undefined)).toBe('PROCESSING');
  });
});
