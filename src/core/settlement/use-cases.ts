import {
  DomainError,
  moneyEquals,
  notFound,
  type Clock,
  type EventBus,
  type ReviewDecision,
  type Verdict,
} from '../shared';
import { decideSettlement, type SettlementAction } from './policy';
import type { PaymentMethodVault, SavedMethodRepository, StakeHolds, StakeRecord, StakeRepository } from './ports';

export interface SettlementDeps {
  stakes: StakeRepository;
  holds: StakeHolds;
  savedMethods: SavedMethodRepository;
  vault: PaymentMethodVault;
  bus: EventBus;
  clock: Clock;
  confidenceThreshold?: number;
}

export function createSettlementUseCases({
  stakes,
  holds,
  savedMethods,
  vault,
  bus,
  clock,
  confidenceThreshold,
}: SettlementDeps) {
  async function load(goalId: string): Promise<StakeRecord> {
    const stake = await stakes.get(goalId);
    if (!stake) throw notFound('Stake for goal', goalId);
    return stake;
  }

  /**
   * Carries out a decided action. The amount always comes from the policy, never from a caller.
   * The decision is saved before PayPal is called, so a failed call can be retried later;
   * the adapter's idempotency keys make a retry safe even if the first call did go through.
   */
  /** Goals whose settlement is talking to PayPal right now. One at a time per goal, or the result is published twice. */
  const inFlight = new Set<string>();

  async function execute(requested: StakeRecord, action: SettlementAction): Promise<void> {
    if (action.type === 'REQUEST_REVIEW') return;
    if (inFlight.has(requested.goalId)) return; // another attempt is already carrying this out
    inFlight.add(requested.goalId);
    try {
      // Work from what is stored now, not from what the caller read earlier: an attempt
      // that finished in the meantime must not be repeated.
      const stake = (await stakes.get(requested.goalId)) ?? requested;
      if (stake.status === 'RELEASED' || stake.status === 'CAPTURED') return;
      await carryOut(stake, action);
    } finally {
      inFlight.delete(requested.goalId);
    }
  }

  async function carryOut(stake: StakeRecord, action: Exclude<SettlementAction, { type: 'REQUEST_REVIEW' }>): Promise<void> {
    const authorizationId = stake.authorizationId;
    if (!authorizationId) throw new DomainError('CONFLICT', 'There is no hold to settle');

    const pending: StakeRecord = { ...stake, pendingAction: action };
    await stakes.save(pending);
    const { pendingAction: _done, lastError: _cleared, deferredVerdict: _used, ...settled } = pending;

    try {
      if (action.type === 'RELEASE') {
        await holds.release(authorizationId);
        const holdStatus = await holds.getHoldStatus(authorizationId);
        await stakes.save({ ...settled, status: 'RELEASED', holdStatus, settledAt: clock.now() });
        await bus.publish({ type: 'StakeReleased', goalId: stake.goalId });
        return;
      }

      const { captureId } = await holds.capture(authorizationId, action.amount);
      const holdStatus = await holds.getHoldStatus(authorizationId);
      await stakes.save({
        ...settled,
        status: 'CAPTURED',
        captureId,
        capturedAmount: action.amount,
        holdStatus,
        settledAt: clock.now(),
      });
      await bus.publish({
        type: 'StakeCaptured',
        goalId: stake.goalId,
        captureId,
        amount: action.amount,
        partial: action.partial,
      });
    } catch (error) {
      // Keep the decision and remember why it did not go through, so it can be shown and retried.
      const current = await stakes.get(stake.goalId);
      if (current?.pendingAction) {
        const message = error instanceof Error ? error.message : 'The payment step failed.';
        await stakes.save({ ...current, lastError: { at: clock.now(), message } });
      }
      throw error;
    }
  }

  /** The provider says the money is held: check the amount, record it, tell the other modules. */
  async function recordHold(stake: StakeRecord, authorizationId: string, amount: StakeRecord['amount']): Promise<StakeRecord> {
    if (!moneyEquals(amount, stake.amount)) {
      await holds.release(authorizationId);
      throw new DomainError('AMOUNT_MISMATCH', 'The authorized amount does not match the stake');
    }
    const holdStatus = await holds.getHoldStatus(authorizationId);
    const held: StakeRecord = { ...stake, status: 'HELD', authorizationId, holdStatus, heldAt: clock.now() };
    await stakes.save(held);
    await bus.publish({ type: 'StakeHeld', goalId: stake.goalId, authorizationId, amount: stake.amount });
    return held;
  }

  function assertBeforeDeadline(stake: StakeRecord): void {
    if (stake.deadline && clock.now().getTime() >= new Date(stake.deadline).getTime()) {
      throw new DomainError('DEADLINE_PASSED', 'This goal expired before a hold was placed. No money was held.');
    }
  }

  function decide(stake: StakeRecord, verdict: Verdict): SettlementAction {
    return decideSettlement({
      kind: 'VERDICT',
      outcome: verdict.outcome,
      confidence: verdict.confidence,
      fractionCompleted: verdict.fractionCompleted,
      stake: stake.amount,
      confidenceThreshold,
    });
  }

  /** Settles on this verdict for good: release, capture, or hand over to a human reviewer. */
  async function finalize(stake: StakeRecord, verdict: Verdict): Promise<void> {
    const { deferredVerdict: _used, ...final } = stake;
    const action = decide(final, verdict);
    if (action.type === 'REQUEST_REVIEW') {
      await stakes.save({ ...final, status: 'IN_REVIEW' });
      await bus.publish({ type: 'ReviewRequested', goalId: stake.goalId, verdict });
      return;
    }
    await execute(final, action);
  }

  return {
    getStake: load,

    /** Step 1 of placing the hold: create the PayPal order the buyer will approve. */
    async startHold(
      goalId: string,
      options: { saveForLater?: boolean; returnUrl?: string } = {},
    ): Promise<{ orderId: string; approveUrl: string }> {
      const stake = await load(goalId);
      if (stake.status !== 'READY' && stake.status !== 'PENDING_APPROVAL') {
        throw new DomainError('CONFLICT', 'This goal is not waiting for a stake');
      }
      assertBeforeDeadline(stake);
      const created = await holds.createHold({
        goalId,
        amount: stake.amount,
        saveForLater: options.saveForLater,
        returnUrl: options.returnUrl,
      });
      await stakes.save({ ...stake, status: 'PENDING_APPROVAL', orderId: created.orderId });
      return created;
    },

    /** Step 2: the buyer approved, so authorize the order and record the hold. */
    async confirmHold(goalId: string): Promise<StakeRecord> {
      const stake = await load(goalId);
      if (stake.status === 'HELD') return stake;
      if (stake.status !== 'PENDING_APPROVAL' || !stake.orderId) {
        throw new DomainError('CONFLICT', 'There is no pending hold to confirm');
      }
      // Never place a hold on a goal that can no longer be met: it could only be forfeited.
      assertBeforeDeadline(stake);
      const { authorizationId, amount, savedMethod } = await holds.confirmHold(stake.orderId);
      const held = await recordHold(stake, authorizationId, amount);
      if (savedMethod && stake.userId) {
        await savedMethods.save({ ...savedMethod, userId: stake.userId, savedAt: clock.now() });
      }
      return held;
    },

    /** One-step hold on the PayPal account the user saved earlier. */
    async holdWithSavedMethod(goalId: string): Promise<StakeRecord> {
      const stake = await load(goalId);
      if (stake.status === 'HELD') return stake;
      if (stake.status !== 'READY' && stake.status !== 'PENDING_APPROVAL') {
        throw new DomainError('CONFLICT', 'This goal is not waiting for a stake');
      }
      assertBeforeDeadline(stake);
      const saved = stake.userId ? await savedMethods.get(stake.userId) : null;
      if (!saved) throw new DomainError('CONFLICT', 'There is no saved PayPal account. Use the PayPal button.');
      let result: Awaited<ReturnType<StakeHolds['holdWithSavedMethod']>>;
      try {
        result = await holds.holdWithSavedMethod({ goalId, amount: stake.amount, savedMethodId: saved.id });
      } catch (error) {
        // The provider no longer accepts the saved method (removed or expired): stop offering it.
        if (error instanceof DomainError && error.code === 'PAYMENT_NOT_APPROVED') await savedMethods.delete(saved.userId);
        throw error;
      }
      return recordHold({ ...stake, orderId: result.orderId }, result.authorizationId, result.amount);
    },

    getSavedMethod: (userId: string) => savedMethods.get(userId),

    /** Step 1 of saving a PayPal account from the Account screen: returns where to send the user to approve it. */
    async startSavingMethod(userId: string, urls: { returnUrl: string; cancelUrl: string }): Promise<{ approveUrl: string }> {
      const { setupId, approveUrl } = await vault.startSaving(urls);
      await savedMethods.savePending({ userId, setupId, startedAt: clock.now() });
      return { approveUrl };
    },

    /** Step 2, after the user approved at PayPal: exchange the approval for a saved method. */
    async finishSavingMethod(userId: string): Promise<{ label?: string }> {
      const pending = await savedMethods.getPending(userId);
      if (!pending) throw new DomainError('CONFLICT', 'There is no PayPal account waiting to be saved. Start again.');
      const method = await vault.finishSaving(pending.setupId);
      await savedMethods.save({ ...method, userId, savedAt: clock.now() });
      await savedMethods.deletePending(userId);
      return { label: method.label };
    },

    async cancelSavingMethod(userId: string): Promise<void> {
      await savedMethods.deletePending(userId);
    },

    /** The user no longer wants one-step holds. Only our reference is removed; holds already placed are unaffected. */
    forgetSavedMethod: (userId: string) => savedMethods.delete(userId),

    /**
     * The payment provider says something about this hold changed. We do not take
     * its word for what: we read the hold back and act on what we read.
     * If the hold ended there while we still thought it was in place (voided in
     * the provider's dashboard, or expired), nothing can be charged any more, so
     * the stake is recorded as released.
     */
    async syncHold(authorizationId: string): Promise<'UNKNOWN_HOLD' | 'BUSY' | 'UNCHANGED' | 'UPDATED' | 'RELEASED'> {
      const stake = await stakes.findByAuthorization(authorizationId);
      if (!stake) return 'UNKNOWN_HOLD';
      // Our own settlement is in progress or waiting to be retried: it will read the status itself.
      if (inFlight.has(stake.goalId) || stake.pendingAction) return 'BUSY';
      const holdStatus = await holds.getHoldStatus(authorizationId);
      const ended = holdStatus === 'VOIDED' || holdStatus === 'EXPIRED' || holdStatus === 'DENIED';
      const noted: StakeRecord = { ...stake, holdStatus, providerNotifiedAt: clock.now() };
      if (ended && (stake.status === 'HELD' || stake.status === 'IN_REVIEW')) {
        const { deferredVerdict: _unused, ...rest } = noted;
        await stakes.save({ ...rest, status: 'RELEASED', endedAtProvider: true, settledAt: clock.now() });
        await bus.publish({ type: 'StakeReleased', goalId: stake.goalId });
        return 'RELEASED';
      }
      await stakes.save(noted);
      return holdStatus === stake.holdStatus ? 'UNCHANGED' : 'UPDATED';
    },

    /** Tries once more, right now, to carry out a decided settlement. Throws if PayPal still refuses. */
    async retrySettlement(goalId: string): Promise<void> {
      const stake = await load(goalId);
      if (!stake.pendingAction || (stake.status !== 'HELD' && stake.status !== 'IN_REVIEW')) {
        throw new DomainError('CONFLICT', 'There is no unfinished payment step for this goal');
      }
      if (inFlight.has(goalId)) throw new DomainError('CONFLICT', 'PayPal is being asked right now. Give it a moment.');
      await execute(stake, stake.pendingAction);
    },

    /** Called by the scheduler: finishes settlements whose PayPal call failed earlier. */
    async retryPendingSettlements(): Promise<number> {
      let settled = 0;
      for (const stake of await stakes.listPending()) {
        if (!stake.pendingAction || (stake.status !== 'HELD' && stake.status !== 'IN_REVIEW')) continue;
        if (inFlight.has(stake.goalId)) continue; // the first attempt is still running
        try {
          await execute(stake, stake.pendingAction);
          settled++;
        } catch {
          // Still failing: it stays pending and is tried again on the next run.
        }
      }
      return settled;
    },

    /** The user gives up on improving a not-good-enough proof and takes its result now. */
    async acceptResult(goalId: string): Promise<void> {
      const stake = await load(goalId);
      if (stake.status !== 'HELD' || stake.pendingAction || stake.awaitingVerdict || !stake.deferredVerdict) {
        throw new DomainError('CONFLICT', 'There is no result to accept for this goal right now');
      }
      await finalize(stake, stake.deferredVerdict);
    },

    async onGoalCreated(goalId: string, userId: string, amount: StakeRecord['amount'], deadline: Date): Promise<void> {
      await stakes.save({ goalId, userId, amount, deadline, status: 'NOT_READY', awaitingVerdict: false, finalAttempt: false });
    },

    async onRulesAccepted(goalId: string): Promise<void> {
      const stake = await load(goalId);
      if (stake.status === 'NOT_READY') await stakes.save({ ...stake, status: 'READY' });
    },

    async onProofSubmitted(goalId: string, finalAttempt: boolean): Promise<void> {
      const stake = await load(goalId);
      await stakes.save({ ...stake, awaitingVerdict: true, finalAttempt });
    },

    async onVerdict(goalId: string, verdict: Verdict): Promise<void> {
      const loaded = await load(goalId);
      // Already settled, in review, or waiting for a retry of an earlier decision: never decide twice.
      if (loaded.status !== 'HELD' || loaded.pendingAction) return;
      const stake: StakeRecord = { ...loaded, awaitingVerdict: false };

      // Good proof settles at once. Anything else is held back while the user can still
      // upload a better photo; the money only moves on a final result.
      const canRetry = !stake.finalAttempt && clock.now().getTime() < new Date(stake.deadline).getTime();
      if (decide(stake, verdict).type !== 'RELEASE' && canRetry) {
        await stakes.save({ ...stake, deferredVerdict: verdict });
        await bus.publish({ type: 'RetryAllowed', goalId, verdict });
        return;
      }
      await finalize(stake, verdict);
    },

    async onDeadlinePassed(goalId: string): Promise<void> {
      const stake = await load(goalId);
      if (stake.status !== 'HELD' || stake.pendingAction) return;
      // A photo that arrived in time is settled by its verdict, even if the verdict comes after the deadline.
      if (stake.awaitingVerdict) return;
      if (stake.deferredVerdict) return finalize(stake, stake.deferredVerdict);
      await execute(stake, decideSettlement({ kind: 'NO_PROOF', stake: stake.amount }));
    },

    async onReviewResolved(goalId: string, decision: ReviewDecision): Promise<void> {
      const stake = await load(goalId);
      if (stake.status !== 'IN_REVIEW' || stake.pendingAction) return;
      const action = decideSettlement({
        kind: 'VERDICT',
        outcome: decision.outcome,
        confidence: 1,
        fractionCompleted: decision.fractionCompleted,
        stake: stake.amount,
        confidenceThreshold,
      });
      await execute(stake, action);
    },
  };
}
