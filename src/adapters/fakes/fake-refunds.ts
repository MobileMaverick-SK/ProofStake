import { DomainError, type Money } from '../../core/shared';
import type { Refunds } from '../../core/appeals';

export class FakeRefunds implements Refunds {
  readonly issued: { refundId: string; captureId: string; amount: Money }[] = [];

  async refund(captureId: string, amount: Money) {
    if (this.issued.some((r) => r.captureId === captureId)) {
      throw new DomainError('PAYMENT_FAILED', 'This capture was already refunded');
    }
    const refundId = `FAKE-REFUND-${this.issued.length + 1}`;
    this.issued.push({ refundId, captureId, amount });
    return { refundId };
  }
}
