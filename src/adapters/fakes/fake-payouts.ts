import type { Payouts, PayoutStatus } from '../../core/pacts';
import { DomainError, type Money } from '../../core/shared';

export class FakePayouts implements Payouts {
  readonly sent: { payoutId: string; goalId: string; amount: Money; recipientEmail: string }[] = [];
  /** Makes the next N sends fail, to exercise retries. */
  failNextSends = 0;
  status: PayoutStatus = 'PAID';

  async send(input: { goalId: string; amount: Money; recipientEmail: string; note: string }) {
    if (this.failNextSends > 0) {
      this.failNextSends -= 1;
      throw new DomainError('PAYMENT_FAILED', 'The payout could not be sent');
    }
    const earlier = this.sent.find((p) => p.goalId === input.goalId);
    if (earlier) return { payoutId: earlier.payoutId };
    const payoutId = `FAKE-PAYOUT-${this.sent.length + 1}`;
    this.sent.push({ payoutId, goalId: input.goalId, amount: input.amount, recipientEmail: input.recipientEmail });
    return { payoutId };
  }

  async getStatus(): Promise<PayoutStatus> {
    return this.status;
  }
}
