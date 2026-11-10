import { z } from 'zod';
import type { Payouts, PayoutStatus } from '../../core/pacts';
import { toDecimalString, type Money } from '../../core/shared';
import type { PayPalClient } from './client';
import { toDomainError } from './errors';

const batchSchema = z.object({
  batch_header: z.object({ payout_batch_id: z.string(), batch_status: z.string().optional() }),
  items: z.array(z.object({ transaction_status: z.string().optional() })).optional(),
});

/** Payouts against the PayPal sandbox: one batch with one item, from the business balance to an email address. */
export class PayPalPayouts implements Payouts {
  constructor(private readonly paypal: PayPalClient) {}

  async send(input: { goalId: string; amount: Money; recipientEmail: string; note: string }) {
    // The same id on a retry makes PayPal treat it as the same payout, so nobody is paid twice.
    const batchId = `proofstake-payout-${input.goalId}`;
    try {
      const batch = batchSchema.parse(
        await this.paypal.post('/v1/payments/payouts', {
          requestId: batchId,
          body: {
            sender_batch_header: {
              sender_batch_id: batchId,
              email_subject: 'You received money from a ProofStake pact',
              email_message: input.note,
            },
            items: [
              {
                recipient_type: 'EMAIL',
                receiver: input.recipientEmail,
                amount: { currency: input.amount.currency, value: toDecimalString(input.amount) },
                note: input.note,
                sender_item_id: input.goalId,
              },
            ],
          },
        }),
      );
      return { payoutId: batch.batch_header.payout_batch_id };
    } catch (error) {
      throw toDomainError(error, 'send the payout');
    }
  }

  async getStatus(payoutId: string): Promise<PayoutStatus> {
    try {
      const batch = batchSchema.parse(await this.paypal.get(`/v1/payments/payouts/${encodeURIComponent(payoutId)}`));
      return toPayoutStatus(batch.items?.[0]?.transaction_status ?? batch.batch_header.batch_status);
    } catch (error) {
      throw toDomainError(error, 'read the payout');
    }
  }
}

/** PayPal reports a status for the batch and one for each item; the item's is the one that matters. */
export function toPayoutStatus(status: string | undefined): PayoutStatus {
  switch (status) {
    case 'SUCCESS':
      return 'PAID';
    case 'UNCLAIMED':
      return 'UNCLAIMED';
    case 'FAILED':
    case 'DENIED':
    case 'CANCELED':
    case 'RETURNED':
    case 'BLOCKED':
    case 'REFUNDED':
    case 'REVERSED':
      return 'FAILED';
    default:
      return 'PROCESSING';
  }
}
