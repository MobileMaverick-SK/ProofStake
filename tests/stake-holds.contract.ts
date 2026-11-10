import { describe, expect, it } from 'vitest';
import type { StakeHolds } from '../src/core/settlement';
import { DomainError, usd } from '../src/core/shared';

export interface StakeHoldsHarness {
  holds: StakeHolds;
  /** Plays the buyer approving the order. For the real adapter this is a human in the sandbox. */
  approve(orderId: string): Promise<void>;
}

/**
 * The behaviour every StakeHolds implementation must have. Run against the
 * in-memory fake here; the PayPal adapter is checked against the same list.
 */
export function stakeHoldsContract(name: string, makeHarness: () => StakeHoldsHarness) {
  describe(`StakeHolds contract: ${name}`, () => {
    const amount = usd(2000);

    async function held(goalId = 'goal_1') {
      const harness = makeHarness();
      const { orderId } = await harness.holds.createHold({ goalId, amount });
      await harness.approve(orderId);
      const { authorizationId } = await harness.holds.confirmHold(orderId);
      return { ...harness, orderId, authorizationId };
    }

    it('creates an order with an approval URL', async () => {
      const { holds } = makeHarness();
      const created = await holds.createHold({ goalId: 'goal_1', amount });
      expect(created.orderId).toBeTruthy();
      expect(created.approveUrl).toMatch(/^https:\/\//);
    });

    it('creating the same hold twice returns the same order', async () => {
      const { holds } = makeHarness();
      const first = await holds.createHold({ goalId: 'goal_1', amount });
      const second = await holds.createHold({ goalId: 'goal_1', amount });
      expect(second.orderId).toBe(first.orderId);
    });

    it('refuses to confirm before the buyer approves', async () => {
      const { holds } = makeHarness();
      const { orderId } = await holds.createHold({ goalId: 'goal_1', amount });
      await expect(holds.confirmHold(orderId)).rejects.toBeInstanceOf(DomainError);
    });

    it('confirms an approved order for exactly the requested amount', async () => {
      const { holds, orderId, authorizationId } = await held();
      expect(await holds.getHoldStatus(authorizationId)).toBe('HELD');
      const again = await holds.confirmHold(orderId);
      expect(again).toEqual({ authorizationId, amount });
    });

    it('release voids the hold, and releasing twice is harmless', async () => {
      const { holds, authorizationId } = await held();
      await holds.release(authorizationId);
      await holds.release(authorizationId);
      expect(await holds.getHoldStatus(authorizationId)).toBe('VOIDED');
    });

    it('captures the full amount', async () => {
      const { holds, authorizationId } = await held();
      const { captureId } = await holds.capture(authorizationId, amount);
      expect(captureId).toBeTruthy();
      expect(await holds.getHoldStatus(authorizationId)).toBe('CAPTURED');
    });

    it('captures part of the amount as the final capture', async () => {
      const { holds, authorizationId } = await held();
      const first = await holds.capture(authorizationId, usd(500));
      expect(await holds.getHoldStatus(authorizationId)).toBe('PARTIALLY_CAPTURED');
      // A second capture must never take more money: it is refused, or it is an
      // idempotent replay that returns the very same capture.
      const second = await holds.capture(authorizationId, usd(500)).catch((error: unknown) => {
        expect(error).toBeInstanceOf(DomainError);
        return null;
      });
      if (second) expect(second.captureId).toBe(first.captureId);
    });

    it('refuses to capture more than was held', async () => {
      const { holds, authorizationId } = await held();
      await expect(holds.capture(authorizationId, usd(2001))).rejects.toBeInstanceOf(DomainError);
    });

    it('refuses to capture after a release, and to release after a capture', async () => {
      const a = await held('goal_a');
      await a.holds.release(a.authorizationId);
      await expect(a.holds.capture(a.authorizationId, amount)).rejects.toBeInstanceOf(DomainError);

      const b = await held('goal_b');
      await b.holds.capture(b.authorizationId, amount);
      await expect(b.holds.release(b.authorizationId)).rejects.toBeInstanceOf(DomainError);
    });
  });
}
