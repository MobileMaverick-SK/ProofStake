import { DomainError, moneyEquals, type Money } from '../../core/shared';
import type { HoldStatus, PaymentMethodVault, StakeHolds } from '../../core/settlement';

interface FakeOrder {
  orderId: string;
  goalId: string;
  amount: Money;
  approved: boolean;
  saveForLater: boolean;
  authorizationId?: string;
}

interface FakeAuthorization {
  amount: Money;
  status: HoldStatus;
  capturedCents: number;
}

/**
 * In-memory stand-in for PayPal, for tests only. It enforces the same rules the
 * sandbox does: no authorization before buyer approval, one final capture, no
 * capture above the held amount, nothing after a void.
 */
export class FakeStakeHolds implements StakeHolds, PaymentMethodVault {
  private readonly orders = new Map<string, FakeOrder>();
  private readonly authorizations = new Map<string, FakeAuthorization>();
  private sequence = 0;
  /** Number of upcoming release/capture calls that fail, like a PayPal outage. */
  failNextWrites = 0;
  /** When set, release and capture wait for this before answering, like a slow PayPal. */
  slowWrites: Promise<void> | null = null;
  writeCalls = 0;

  /** Test helper: plays the buyer clicking "approve" in the PayPal popup. */
  approve(orderId: string): void {
    this.order(orderId).approved = true;
  }

  capturedCents(authorizationId: string): number {
    return this.authorization(authorizationId).capturedCents;
  }

  /** Saved methods the fake provider knows, by token. Delete one to play "the buyer removed it at PayPal". */
  readonly savedMethods = new Set<string>();

  private readonly setups = new Map<string, { approved: boolean }>();

  /** Test helper: plays the buyer approving "save my account" at PayPal. */
  approveSetup(setupId: string): void {
    this.setups.get(setupId)!.approved = true;
  }

  async startSaving(input: { returnUrl: string; cancelUrl: string }) {
    const setupId = `FAKE-SETUP-${++this.sequence}`;
    this.setups.set(setupId, { approved: false });
    return { setupId, approveUrl: `https://fake.paypal.test/save/${setupId}?return=${encodeURIComponent(input.returnUrl)}` };
  }

  async finishSaving(setupId: string) {
    if (!this.setups.get(setupId)?.approved) {
      throw new DomainError('PAYMENT_NOT_APPROVED', 'The PayPal account was not approved for saving');
    }
    const id = `FAKE-VAULT-${setupId}`;
    this.savedMethods.add(id);
    return { id, label: 'buyer@example.test' };
  }

  async createHold(input: { goalId: string; amount: Money; saveForLater?: boolean; returnUrl?: string }) {
    // Same goal, same amount: same order. Mirrors PayPal-Request-Id idempotency.
    for (const existing of this.orders.values()) {
      if (existing.goalId === input.goalId && moneyEquals(existing.amount, input.amount)) {
        return { orderId: existing.orderId, approveUrl: `https://fake.paypal.test/approve/${existing.orderId}` };
      }
    }
    const orderId = `FAKE-ORDER-${++this.sequence}`;
    this.orders.set(orderId, {
      orderId,
      goalId: input.goalId,
      amount: input.amount,
      approved: false,
      saveForLater: input.saveForLater ?? false,
    });
    return { orderId, approveUrl: `https://fake.paypal.test/approve/${orderId}` };
  }

  async confirmHold(orderId: string) {
    const order = this.order(orderId);
    if (!order.approved) {
      throw new DomainError('PAYMENT_NOT_APPROVED', 'The buyer has not approved this order');
    }
    if (!order.authorizationId) {
      order.authorizationId = `FAKE-AUTH-${++this.sequence}`;
      this.authorizations.set(order.authorizationId, { amount: order.amount, status: 'HELD', capturedCents: 0 });
    }
    if (!order.saveForLater) return { authorizationId: order.authorizationId, amount: order.amount };
    const savedMethod = { id: `FAKE-VAULT-${order.orderId}`, label: 'buyer@example.test' };
    this.savedMethods.add(savedMethod.id);
    return { authorizationId: order.authorizationId, amount: order.amount, savedMethod };
  }

  async holdWithSavedMethod(input: { goalId: string; amount: Money; savedMethodId: string }) {
    if (!this.savedMethods.has(input.savedMethodId)) {
      throw new DomainError('PAYMENT_NOT_APPROVED', 'The saved PayPal account can no longer be used');
    }
    const orderId = `FAKE-ORDER-${++this.sequence}`;
    const authorizationId = `FAKE-AUTH-${++this.sequence}`;
    this.authorizations.set(authorizationId, { amount: input.amount, status: 'HELD', capturedCents: 0 });
    return { orderId, authorizationId, amount: input.amount };
  }

  async release(authorizationId: string) {
    await this.beforeWrite();
    const auth = this.authorization(authorizationId);
    if (auth.status === 'VOIDED') return;
    if (auth.status !== 'HELD') {
      throw new DomainError('PAYMENT_FAILED', `Cannot void an authorization that is ${auth.status}`);
    }
    auth.status = 'VOIDED';
  }

  async capture(authorizationId: string, amount: Money) {
    await this.beforeWrite();
    const auth = this.authorization(authorizationId);
    if (auth.status !== 'HELD') {
      throw new DomainError('PAYMENT_FAILED', `Cannot capture an authorization that is ${auth.status}`);
    }
    if (amount.cents <= 0 || amount.cents > auth.amount.cents || amount.currency !== auth.amount.currency) {
      throw new DomainError('PAYMENT_FAILED', 'Capture amount must be positive and at most the held amount');
    }
    auth.capturedCents = amount.cents;
    auth.status = amount.cents === auth.amount.cents ? 'CAPTURED' : 'PARTIALLY_CAPTURED';
    return { captureId: `FAKE-CAPTURE-${++this.sequence}` };
  }

  async getHoldStatus(authorizationId: string) {
    return this.authorization(authorizationId).status;
  }

  private async beforeWrite(): Promise<void> {
    this.writeCalls++;
    if (this.slowWrites) await this.slowWrites;
    this.maybeFail();
  }

  private maybeFail(): void {
    if (this.failNextWrites > 0) {
      this.failNextWrites--;
      throw new DomainError('PAYMENT_FAILED', 'fake PayPal outage');
    }
  }

  private order(orderId: string): FakeOrder {
    const order = this.orders.get(orderId);
    if (!order) throw new DomainError('NOT_FOUND', `Order ${orderId} not found`);
    return order;
  }

  private authorization(authorizationId: string): FakeAuthorization {
    const auth = this.authorizations.get(authorizationId);
    if (!auth) throw new DomainError('NOT_FOUND', `Authorization ${authorizationId} not found`);
    return auth;
  }
}
