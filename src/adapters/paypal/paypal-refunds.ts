import { z } from 'zod';
import type { Refunds } from '../../core/appeals';
import { DomainError, toDecimalString, type Money } from '../../core/shared';
import type { PayPalClient } from './client';
import { toDomainError } from './errors';

const refundSchema = z.object({ id: z.string(), status: z.string() });

/** Refunds against the PayPal sandbox: Payments v2, refund a captured payment. */
export class PayPalRefunds implements Refunds {
  constructor(private readonly paypal: PayPalClient) {}

  async refund(captureId: string, amount: Money) {
    try {
      const refund = refundSchema.parse(
        await this.paypal.post(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
          requestId: `proofstake-refund-${captureId}`,
          body: { amount: { currency_code: amount.currency, value: toDecimalString(amount) } },
        }),
      );
      if (refund.status === 'FAILED' || refund.status === 'CANCELLED') {
        throw new DomainError('PAYMENT_FAILED', 'PayPal could not complete the refund.');
      }
      return { refundId: refund.id };
    } catch (error) {
      throw toDomainError(error, 'refund the capture');
    }
  }
}
