import { describe, expect, it } from 'vitest';
import type { FakeProofVerifier } from '../src/adapters/fakes';
import { DomainError, usd } from '../src/core/shared';
import { BACKENDS, HOUR, PHOTO, TEST_CODE, USER, setup as baseSetup } from './helpers';

/**
 * The whole product loop on in-memory fakes: every module, wired exactly as in
 * production, talking only through domain events.
 */
describe.each(BACKENDS)('$name', (backend) => {
const setup = (options: { confidenceThreshold?: number } = {}) => baseSetup(options, backend);

describe('full flow on fakes', () => {
  it('goal met: rules, hold, proof, PASS, hold voided, user pays nothing', async () => {
    const { app, ports, stateOf } = setup();

    const goal = await app.goals.createGoal({
      userId: USER,
      text: 'Finish chapter 3 notes',
      deadline: new Date(ports.clock.now().getTime() + 24 * HOUR),
      stakeCents: 2000,
    });
    expect(goal.state).toBe('RULES_PROPOSED'); // the rules were drafted in reaction to GoalCreated
    expect((await app.proofRules.getRules(goal.id)).rules?.checks).toHaveLength(2);

    await app.proofRules.acceptRules(goal.id);
    expect(await stateOf(goal.id)).toBe('AWAITING_STAKE');

    const { orderId, approveUrl } = await app.settlement.startHold(goal.id);
    expect(approveUrl).toContain(orderId);
    await expect(app.settlement.confirmHold(goal.id)).rejects.toMatchObject({ code: 'PAYMENT_NOT_APPROVED' });
    expect(await stateOf(goal.id)).toBe('AWAITING_STAKE');

    ports.stakeHolds.approve(orderId);
    const stake = await app.settlement.confirmHold(goal.id);
    expect(stake).toMatchObject({ status: 'HELD', holdStatus: 'HELD', amount: usd(2000) });
    expect(await stateOf(goal.id)).toBe('ACTIVE');

    const slot = await app.proofIntake.getProofSlot(goal.id);
    expect(slot).toMatchObject({ status: 'OPEN', challengeCode: TEST_CODE });

    await app.proofIntake.submitProof({ goalId: goal.id, file: PHOTO, mimeType: 'image/jpeg' });

    // The verifier was given the stored photo, the accepted rules and the one-time code.
    expect(ports.proofVerifier.calls).toHaveLength(1);
    expect(ports.proofVerifier.calls[0]).toMatchObject({ challengeCode: TEST_CODE, proofUrl: 'memory://proof/1' });
    expect(ports.proofStore.files.get('memory://proof/1')?.file.equals(PHOTO)).toBe(true);

    expect(await stateOf(goal.id)).toBe('SETTLED_RELEASED');
    expect((await app.verification.getVerdict(goal.id)).outcome).toBe('PASS');
    expect((await app.proofIntake.getProofSlot(goal.id)).status).toBe('CLOSED');
    expect(await ports.stakeHolds.getHoldStatus(stake.authorizationId!)).toBe('VOIDED');
    expect(ports.stakeHolds.capturedCents(stake.authorizationId!)).toBe(0);
    expect(await app.settlement.getStake(goal.id)).toMatchObject({ status: 'RELEASED', holdStatus: 'VOIDED' });
    expect(ports.handlerErrors).toEqual([]);
  });

  it('goal partly met: a proportional part is captured and the rest released', async () => {
    const { app, ports, activeGoal, submitFinal, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000);

    ports.proofVerifier.respondWith({ outcome: 'PARTIAL', fractionCompleted: 0.75 });
    await submitFinal(goalId);

    expect(await stateOf(goalId)).toBe('SETTLED_PARTIAL');
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(500);
    expect(await ports.stakeHolds.getHoldStatus(authorizationId)).toBe('PARTIALLY_CAPTURED');
    expect((await app.goals.getGoal(goalId)).capture?.amount).toEqual(usd(500));
    expect(ports.handlerErrors).toEqual([]);
  });

  it('goal missed: FAIL captures the full stake', async () => {
    const { ports, activeGoal, submitFinal, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000);

    ports.proofVerifier.respondWith({ outcome: 'FAIL', fractionCompleted: 0 });
    await submitFinal(goalId);

    expect(await stateOf(goalId)).toBe('SETTLED_FORFEITED');
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(2000);
    expect(await ports.stakeHolds.getHoldStatus(authorizationId)).toBe('CAPTURED');
    expect(ports.handlerErrors).toEqual([]);
  });

  it('a missing one-time code is a FAIL, whatever else the model says', async () => {
    const { app, ports, activeGoal, submitFinal, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000);

    ports.proofVerifier.respondWith({ outcome: 'PASS', fractionCompleted: 1, codeFound: false });
    await submitFinal(goalId);

    expect(await app.verification.getVerdict(goalId)).toMatchObject({ outcome: 'FAIL', fractionCompleted: 0 });
    expect(await stateOf(goalId)).toBe('SETTLED_FORFEITED');
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(2000);
  });

  it('no proof by the deadline: the scheduler captures the full stake, once', async () => {
    const { app, ports, activeGoal, submit, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000, 24);

    ports.clock.advance(23 * HOUR);
    expect(await app.goals.tickDeadlines()).toBe(0);
    expect(await stateOf(goalId)).toBe('ACTIVE');

    ports.clock.advance(2 * HOUR);
    expect(await app.goals.tickDeadlines()).toBe(1);
    expect(await stateOf(goalId)).toBe('SETTLED_FORFEITED');
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(2000);

    expect(await app.goals.tickDeadlines()).toBe(0);
    await expect(submit(goalId)).rejects.toBeInstanceOf(DomainError);
    expect(ports.handlerErrors).toEqual([]);
  });

  it('low confidence: no money moves until a reviewer decides', async () => {
    const { app, ports, activeGoal, submitFinal, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000);

    ports.proofVerifier.respondWith({ outcome: 'FAIL', fractionCompleted: 0, confidence: 0.4 });
    await submitFinal(goalId);

    expect(await stateOf(goalId)).toBe('IN_REVIEW');
    expect(await ports.stakeHolds.getHoldStatus(authorizationId)).toBe('HELD');
    const [reviewCase] = await app.appeals.listCases({ status: 'OPEN' });
    expect(reviewCase).toMatchObject({ goalId, kind: 'LOW_CONFIDENCE', verdict: { confidence: 0.4 } });

    // The deadline passing while a human is deciding must not forfeit the stake.
    ports.clock.advance(48 * HOUR);
    await app.goals.tickDeadlines();
    expect(await stateOf(goalId)).toBe('IN_REVIEW');
    expect(await ports.stakeHolds.getHoldStatus(authorizationId)).toBe('HELD');

    await app.appeals.resolveReview(reviewCase!.id, { outcome: 'PASS', fractionCompleted: 1 });
    expect(await stateOf(goalId)).toBe('SETTLED_RELEASED');
    expect(await ports.stakeHolds.getHoldStatus(authorizationId)).toBe('VOIDED');
    await expect(
      app.appeals.resolveReview(reviewCase!.id, { outcome: 'FAIL', fractionCompleted: 0 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(ports.handlerErrors).toEqual([]);
  });

  it('a reviewer can also decide a partial capture', async () => {
    const { app, ports, activeGoal, submitFinal, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(3000);

    ports.proofVerifier.respondWith({ outcome: 'PASS', confidence: 0.5 });
    await submitFinal(goalId);
    const [reviewCase] = await app.appeals.listCases({ status: 'OPEN' });
    await app.appeals.resolveReview(reviewCase!.id, { outcome: 'PARTIAL', fractionCompleted: 0.5 });

    expect(await stateOf(goalId)).toBe('SETTLED_PARTIAL');
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(1500);
  });

  it.each<[string, (verifier: FakeProofVerifier) => void]>([
    ['the verifier is down', (v) => v.failNext()],
    ['the model returns invalid JSON', (v) => v.respondWithRaw({ outcome: 'MAYBE', confidence: 7 })],
  ])('when %s the case goes to review instead of moving money', async (_name, breakVerifier) => {
    const { app, ports, activeGoal, submitFinal, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000);

    breakVerifier(ports.proofVerifier);
    await submitFinal(goalId);

    expect(await stateOf(goalId)).toBe('IN_REVIEW');
    expect(await ports.stakeHolds.getHoldStatus(authorizationId)).toBe('HELD');
    expect(await app.appeals.listCases({ status: 'OPEN' })).toHaveLength(1);
    expect(ports.handlerErrors).toEqual([]);
  });

  it('appeal upheld: exactly the captured amount is refunded', async () => {
    const { app, ports, activeGoal, submitFinal, stateOf } = setup();
    const { goalId } = await activeGoal(2000);
    ports.proofVerifier.respondWith({ outcome: 'PARTIAL', fractionCompleted: 0.25 });
    await submitFinal(goalId);
    expect(await stateOf(goalId)).toBe('SETTLED_PARTIAL');

    const appeal = await app.appeals.fileAppeal(goalId, 'The second page was cut off in the photo.');
    await expect(app.appeals.fileAppeal(goalId, 'Asking a second time.')).rejects.toMatchObject({ code: 'CONFLICT' });

    await app.appeals.decideAppeal(appeal.id, true);

    const goal = await app.goals.getGoal(goalId);
    expect(goal.state).toBe('REFUNDED');
    expect(goal.refund).toEqual({ refundId: 'FAKE-REFUND-1', amount: usd(1500) });
    expect(ports.refunds.issued).toEqual([
      { refundId: 'FAKE-REFUND-1', captureId: goal.capture!.captureId, amount: usd(1500) },
    ]);
    expect(ports.handlerErrors).toEqual([]);
  });

  it('appeal rejected: the capture stands and nothing is refunded', async () => {
    const { app, ports, activeGoal, stateOf } = setup();
    const { goalId } = await activeGoal(2000, 1);
    ports.clock.advance(2 * HOUR);
    await app.goals.tickDeadlines();

    const appeal = await app.appeals.fileAppeal(goalId, 'I was ill that day.');
    const decided = await app.appeals.decideAppeal(appeal.id, false);

    expect(decided.resolution).toEqual({ kind: 'APPEAL_REJECTED' });
    expect(await stateOf(goalId)).toBe('SETTLED_FORFEITED');
    expect(ports.refunds.issued).toEqual([]);
  });

  it('there is nothing to appeal when the hold was released', async () => {
    const { app, activeGoal, submit } = setup();
    const { goalId } = await activeGoal();
    await submit(goalId);
    await expect(app.appeals.fileAppeal(goalId, 'I want my money back.')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('uploading again after a proof is not approved', () => {
  it('a rejected photo moves no money, and a better second photo releases the hold', async () => {
    const { app, ports, activeGoal, submit, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000);

    ports.proofVerifier.respondWith({ outcome: 'FAIL', fractionCompleted: 0 });
    await submit(goalId);
    expect(await stateOf(goalId)).toBe('ACTIVE');
    expect(await ports.stakeHolds.getHoldStatus(authorizationId)).toBe('HELD');
    expect((await app.proofIntake.getProofSlot(goalId)).status).toBe('OPEN');
    expect((await app.verification.getVerdict(goalId)).outcome).toBe('FAIL');

    await submit(goalId); // the fake verifier answers PASS by default
    expect(await stateOf(goalId)).toBe('SETTLED_RELEASED');
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(0);
    expect(ports.proofVerifier.calls).toHaveLength(2);
    expect(ports.handlerErrors).toEqual([]);
  });

  it('the third photo is the last: its result settles at once', async () => {
    const { app, ports, activeGoal, submit, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000);
    for (let attempt = 1; attempt <= 3; attempt++) {
      ports.proofVerifier.respondWith({ outcome: 'PARTIAL', fractionCompleted: 0.25 * attempt });
      await submit(goalId);
      expect(await stateOf(goalId)).toBe(attempt < 3 ? 'ACTIVE' : 'SETTLED_PARTIAL');
    }
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(500); // 25% left undone on the last try
    await expect(submit(goalId)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await app.proofIntake.getProofSlot(goalId)).attempts).toBe(3);
    expect(ports.handlerErrors).toEqual([]);
  });

  it('if the user does not try again, the last result is settled at the deadline', async () => {
    const { app, ports, activeGoal, submit, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000, 24);
    ports.proofVerifier.respondWith({ outcome: 'PARTIAL', fractionCompleted: 0.5 });
    await submit(goalId);

    ports.clock.advance(23 * HOUR);
    await app.goals.tickDeadlines();
    expect(await stateOf(goalId)).toBe('ACTIVE');
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(0);

    ports.clock.advance(2 * HOUR);
    await app.goals.tickDeadlines();
    expect(await stateOf(goalId)).toBe('SETTLED_PARTIAL');
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(1000);
    await expect(submit(goalId)).rejects.toBeInstanceOf(DomainError);
    expect(ports.handlerErrors).toEqual([]);
  });

  it('the user can take a not-approved result as final instead of trying again', async () => {
    const { app, ports, activeGoal, submit, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000);
    await expect(app.settlement.acceptResult(goalId)).rejects.toMatchObject({ code: 'CONFLICT' }); // nothing to accept yet

    ports.proofVerifier.respondWith({ outcome: 'FAIL', fractionCompleted: 0 });
    await submit(goalId);
    await app.settlement.acceptResult(goalId);
    expect(await stateOf(goalId)).toBe('SETTLED_FORFEITED');
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(2000);
    expect((await app.settlement.getStake(goalId)).deferredVerdict).toBeUndefined();
    await expect(app.settlement.acceptResult(goalId)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(submit(goalId)).rejects.toBeInstanceOf(DomainError);
  });

  it('an unsure verdict can also be retried, and only goes to review when it is final', async () => {
    const { app, ports, activeGoal, submit, stateOf } = setup();
    const { goalId } = await activeGoal(2000);
    ports.proofVerifier.respondWith({ confidence: 0.4 });
    await submit(goalId);
    expect(await stateOf(goalId)).toBe('ACTIVE');
    expect(await app.appeals.listCases({ status: 'OPEN' })).toHaveLength(0);

    await app.settlement.acceptResult(goalId);
    expect(await stateOf(goalId)).toBe('IN_REVIEW');
    expect(await app.appeals.listCases({ status: 'OPEN' })).toHaveLength(1);
  });

  it('a photo uploaded just before the deadline is final once its verdict arrives after it', async () => {
    const { app, ports, activeGoal, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000, 2);
    ports.proofVerifier.respondWith({ outcome: 'FAIL', fractionCompleted: 0 });
    const scripted = ports.proofVerifier.verify.bind(ports.proofVerifier);
    ports.proofVerifier.verify = async (input) => {
      ports.clock.advance(3 * HOUR); // the deadline passes while the photo is being checked
      await app.goals.tickDeadlines();
      return scripted(input);
    };
    await app.proofIntake.submitProof({ goalId, file: PHOTO, mimeType: 'image/jpeg' });

    expect(await stateOf(goalId)).toBe('SETTLED_FORFEITED');
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(2000);
    expect(ports.handlerErrors).toEqual([]);
  });
});

describe('saved PayPal account', () => {
  async function goalAwaitingStake(app: ReturnType<typeof baseSetup>['app'], ports: ReturnType<typeof baseSetup>['ports'], userId = USER) {
    const goal = await app.goals.createGoal({
      userId,
      text: 'Finish chapter 3 notes',
      deadline: new Date(ports.clock.now().getTime() + 24 * HOUR),
      stakeCents: 2000,
    });
    await app.proofRules.acceptRules(goal.id);
    return goal.id;
  }

  it('is remembered after the first approved hold, and the next goal is held in one step', async () => {
    const { app, ports, stateOf } = setup();
    expect(await app.settlement.getSavedMethod(USER)).toBeNull();

    const first = await goalAwaitingStake(app, ports);
    const { orderId } = await app.settlement.startHold(first, { saveForLater: true });
    ports.stakeHolds.approve(orderId);
    await app.settlement.confirmHold(first);
    expect(await app.settlement.getSavedMethod(USER)).toMatchObject({ userId: USER, label: 'buyer@example.test' });

    const second = await goalAwaitingStake(app, ports);
    const stake = await app.settlement.holdWithSavedMethod(second);
    expect(stake).toMatchObject({ status: 'HELD', holdStatus: 'HELD', amount: usd(2000) });
    expect(await stateOf(second)).toBe('ACTIVE');
    expect((await app.proofIntake.getProofSlot(second)).status).toBe('OPEN');
    expect(ports.handlerErrors).toEqual([]);
  });

  it('is not remembered unless the user asked for it, and never shared between users', async () => {
    const { app, ports } = setup();
    const mine = await goalAwaitingStake(app, ports);
    const { orderId } = await app.settlement.startHold(mine);
    ports.stakeHolds.approve(orderId);
    await app.settlement.confirmHold(mine);
    expect(await app.settlement.getSavedMethod(USER)).toBeNull();
    await expect(app.settlement.holdWithSavedMethod(await goalAwaitingStake(app, ports))).rejects.toMatchObject({ code: 'CONFLICT' });

    const saving = await goalAwaitingStake(app, ports);
    const order = await app.settlement.startHold(saving, { saveForLater: true });
    ports.stakeHolds.approve(order.orderId);
    await app.settlement.confirmHold(saving);
    const theirs = await goalAwaitingStake(app, ports, 'someone_else');
    await expect(app.settlement.holdWithSavedMethod(theirs)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('can be removed, and is dropped when PayPal stops accepting it', async () => {
    const { app, ports, stateOf } = setup();
    const save = async () => {
      const goalId = await goalAwaitingStake(app, ports);
      const { orderId } = await app.settlement.startHold(goalId, { saveForLater: true });
      ports.stakeHolds.approve(orderId);
      await app.settlement.confirmHold(goalId);
    };
    await save();
    await app.settlement.forgetSavedMethod(USER);
    expect(await app.settlement.getSavedMethod(USER)).toBeNull();

    await save();
    ports.stakeHolds.savedMethods.clear(); // the buyer removed ProofStake from their PayPal account
    const goalId = await goalAwaitingStake(app, ports);
    await expect(app.settlement.holdWithSavedMethod(goalId)).rejects.toMatchObject({ code: 'PAYMENT_NOT_APPROVED' });
    expect(await app.settlement.getSavedMethod(USER)).toBeNull();
    expect(await stateOf(goalId)).toBe('AWAITING_STAKE');

    // The ordinary PayPal button still works for that goal.
    const { orderId } = await app.settlement.startHold(goalId);
    ports.stakeHolds.approve(orderId);
    await app.settlement.confirmHold(goalId);
    expect(await stateOf(goalId)).toBe('ACTIVE');
  });

  it('can be added from the account screen without placing a hold', async () => {
    const { app, ports, stateOf } = setup();
    const urls = { returnUrl: 'https://app.example.test/account/paypal/return', cancelUrl: 'https://app.example.test/account' };
    await expect(app.settlement.finishSavingMethod(USER)).rejects.toMatchObject({ code: 'CONFLICT' }); // nothing started

    const { approveUrl } = await app.settlement.startSavingMethod(USER, urls);
    expect(approveUrl).toMatch(/^https:/);
    await expect(app.settlement.finishSavingMethod(USER)).rejects.toMatchObject({ code: 'PAYMENT_NOT_APPROVED' });
    expect(await app.settlement.getSavedMethod(USER)).toBeNull();

    const pending = await ports.savedMethodRepository.getPending(USER);
    ports.stakeHolds.approveSetup(pending!.setupId);
    expect(await app.settlement.finishSavingMethod(USER)).toEqual({ label: 'buyer@example.test' });
    expect(await app.settlement.getSavedMethod(USER)).toMatchObject({ label: 'buyer@example.test' });
    expect(await ports.savedMethodRepository.getPending(USER)).toBeNull();

    const goalId = await goalAwaitingStake(app, ports);
    await app.settlement.holdWithSavedMethod(goalId);
    expect(await stateOf(goalId)).toBe('ACTIVE');
  });

  it('cannot place a one-step hold after the deadline', async () => {
    const { app, ports } = setup();
    const first = await goalAwaitingStake(app, ports);
    const { orderId } = await app.settlement.startHold(first, { saveForLater: true });
    ports.stakeHolds.approve(orderId);
    await app.settlement.confirmHold(first);
    const late = await goalAwaitingStake(app, ports);
    ports.clock.advance(25 * HOUR);
    await expect(app.settlement.holdWithSavedMethod(late)).rejects.toMatchObject({ code: 'DEADLINE_PASSED' });
  });
});

describe('guards', () => {
  it('rejects goals longer than 3 days, in the past, or with a silly stake', async () => {
    const { app, ports } = setup();
    const inHours = (h: number) => new Date(ports.clock.now().getTime() + h * HOUR);
    const create = (deadline: Date, stakeCents: number) =>
      app.goals.createGoal({ userId: USER, text: 'Finish chapter 3 notes', deadline, stakeCents });

    await expect(create(inHours(72.01), 2000)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(create(inHours(-1), 2000)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(create(inHours(24), 50)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(create(inHours(24), 19.99)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(create(inHours(24), 50_001)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await create(inHours(72), 2000)).state).toBe('RULES_PROPOSED');
    expect(await app.goals.listGoals(USER)).toHaveLength(1);
  });

  it('no hold before the rules are accepted, and no proof before the hold', async () => {
    const { app, ports, submit } = setup();
    const goal = await app.goals.createGoal({
      userId: USER,
      text: 'Finish chapter 3 notes',
      deadline: new Date(ports.clock.now().getTime() + HOUR),
      stakeCents: 2000,
    });
    await expect(app.settlement.startHold(goal.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await app.proofRules.acceptRules(goal.id);
    await expect(submit(goal.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('no hold can be started or confirmed once the deadline has passed', async () => {
    const { app, ports, stateOf } = setup();
    const make = async () => {
      const goal = await app.goals.createGoal({
        userId: USER,
        text: 'Finish chapter 3 notes',
        deadline: new Date(ports.clock.now().getTime() + HOUR),
        stakeCents: 2000,
      });
      await app.proofRules.acceptRules(goal.id);
      return goal.id;
    };
    const late = await make();
    const approvedLate = await make();
    const { orderId } = await app.settlement.startHold(approvedLate);
    ports.stakeHolds.approve(orderId);

    ports.clock.advance(2 * HOUR);
    await expect(app.settlement.startHold(late)).rejects.toMatchObject({ code: 'DEADLINE_PASSED' });
    await expect(app.settlement.confirmHold(approvedLate)).rejects.toMatchObject({ code: 'DEADLINE_PASSED' });
    expect(await stateOf(approvedLate)).toBe('AWAITING_STAKE');
    await app.goals.tickDeadlines();
    expect(await stateOf(late)).toBe('AWAITING_STAKE'); // nothing was held, so nothing is forfeited
  });

  it('records when the hold was placed and when the money settled', async () => {
    const { app, ports, activeGoal, submit } = setup();
    const start = ports.clock.now();
    const { goalId } = await activeGoal(2000);
    ports.clock.advance(HOUR);
    await submit(goalId);
    const stake = await app.settlement.getStake(goalId);
    expect(new Date(stake.heldAt!)).toEqual(start);
    expect(new Date(stake.settledAt!)).toEqual(new Date(start.getTime() + HOUR));
  });

  it('rules can be regenerated until accepted, and a writer outage can be retried', async () => {
    const { app, ports, stateOf } = setup();
    ports.ruleWriter.failNext = true;
    const goal = await app.goals.createGoal({
      userId: USER,
      text: 'Finish chapter 3 notes',
      deadline: new Date(ports.clock.now().getTime() + HOUR),
      stakeCents: 2000,
    });
    expect(goal.state).toBe('DRAFT');
    expect((await app.proofRules.getRules(goal.id)).status).toBe('DRAFT_FAILED');
    await expect(app.proofRules.acceptRules(goal.id)).rejects.toMatchObject({ code: 'CONFLICT' });

    await app.proofRules.regenerateRules(goal.id);
    expect(await stateOf(goal.id)).toBe('RULES_PROPOSED');
    await app.proofRules.regenerateRules(goal.id);
    expect(ports.ruleWriter.calls).toBe(3);

    await app.proofRules.acceptRules(goal.id);
    await expect(app.proofRules.regenerateRules(goal.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(ports.handlerErrors).toEqual([]);
  });

  it('proof is accepted once, only as an image, and only before the deadline', async () => {
    const { app, ports, activeGoal, submit } = setup();
    const a = await activeGoal(2000, 2);
    await expect(
      app.proofIntake.submitProof({ goalId: a.goalId, file: PHOTO, mimeType: 'application/pdf' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      app.proofIntake.submitProof({ goalId: a.goalId, file: Buffer.alloc(0), mimeType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await submit(a.goalId);
    await expect(submit(a.goalId)).rejects.toMatchObject({ code: 'CONFLICT' });

    // Late, before the scheduler has even run: still refused.
    const b = await activeGoal(2000, 2);
    ports.clock.advance(3 * HOUR);
    await expect(submit(b.goalId)).rejects.toMatchObject({ code: 'DEADLINE_PASSED' });
  });

  it('a verdict that arrives after the deadline still settles proof that was on time', async () => {
    const { app, ports, activeGoal, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000, 2);

    // Submit on time, but let the deadline pass and the scheduler run while verification is "in flight".
    const originalVerify = ports.proofVerifier.verify.bind(ports.proofVerifier);
    ports.proofVerifier.verify = async (input) => {
      ports.clock.advance(3 * HOUR);
      await app.goals.tickDeadlines();
      return originalVerify(input);
    };
    await app.proofIntake.submitProof({ goalId, file: PHOTO, mimeType: 'image/jpeg' });

    expect(await stateOf(goalId)).toBe('SETTLED_RELEASED');
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(0);
    expect(ports.handlerErrors).toEqual([]);
  });

  it('a PayPal outage during settlement is retried until it goes through, and settles once', async () => {
    const { app, ports, activeGoal, submit, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000);
    ports.proofVerifier.respondWith({ outcome: 'PARTIAL', fractionCompleted: 0.5 });
    await submit(goalId);
    ports.stakeHolds.failNextWrites = 2;

    await expect(app.settlement.acceptResult(goalId)).rejects.toMatchObject({ code: 'PAYMENT_FAILED' });
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(0);
    expect((await app.settlement.getStake(goalId)).pendingAction).toMatchObject({ type: 'CAPTURE', amount: usd(1000) });

    expect((await app.settlement.getStake(goalId)).lastError?.message).toBe('fake PayPal outage');

    expect(await app.settlement.retryPendingSettlements()).toBe(0); // PayPal still down
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(0);

    expect(await app.settlement.retryPendingSettlements()).toBe(1);
    expect(await stateOf(goalId)).toBe('SETTLED_PARTIAL');
    expect(ports.stakeHolds.capturedCents(authorizationId)).toBe(1000);
    expect((await app.settlement.getStake(goalId)).pendingAction).toBeUndefined();
    expect((await app.settlement.getStake(goalId)).lastError).toBeUndefined();

    expect(await app.settlement.retryPendingSettlements()).toBe(0);
    await expect(app.settlement.retrySettlement(goalId)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(ports.handlerErrors).toEqual([]);
  });

  it('the scheduler does not repeat a settlement that is still talking to PayPal', async () => {
    const { app, ports, activeGoal, submit, stateOf } = setup();
    const { goalId, authorizationId } = await activeGoal(2000);
    ports.proofVerifier.respondWith({ confidence: 0.4 });
    await submit(goalId);
    await app.settlement.acceptResult(goalId);
    const [reviewCase] = await app.appeals.listCases({ status: 'OPEN' });

    // PayPal is slow: the reviewer's decision is mid-flight when the scheduler runs.
    let finish!: () => void;
    ports.stakeHolds.slowWrites = new Promise<void>((resolve) => (finish = resolve));
    const deciding = app.appeals.resolveReview(reviewCase!.id, { outcome: 'PASS', fractionCompleted: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await app.settlement.getStake(goalId)).pendingAction).toEqual({ type: 'RELEASE' });

    expect(await app.settlement.retryPendingSettlements()).toBe(0);
    await expect(app.settlement.retrySettlement(goalId)).rejects.toMatchObject({ code: 'CONFLICT' });
    finish();
    await deciding;
    expect(await app.settlement.retryPendingSettlements()).toBe(0);

    expect(ports.stakeHolds.writeCalls).toBe(1);
    expect(await stateOf(goalId)).toBe('SETTLED_RELEASED');
    expect(await ports.stakeHolds.getHoldStatus(authorizationId)).toBe('VOIDED');
    expect(ports.handlerErrors).toEqual([]);
  });

  it('the confidence threshold is configurable', async () => {
    const { ports, activeGoal, submitFinal, stateOf } = setup({ confidenceThreshold: 0.99 });
    const { goalId } = await activeGoal();
    ports.proofVerifier.respondWith({ confidence: 0.95 });
    await submitFinal(goalId);
    expect(await stateOf(goalId)).toBe('IN_REVIEW');
  });
});
});
