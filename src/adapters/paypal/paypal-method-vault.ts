import { z } from 'zod';
import type { PaymentMethodVault } from '../../core/settlement';
import { DomainError } from '../../core/shared';
import { logServerError } from '../server-log';
import { PayPalApiError, type PayPalClient } from './client';
import { toDomainError } from './errors';

const setupSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  links: z.array(z.object({ rel: z.string(), href: z.string() })).optional(),
});
const paymentTokenSchema = z.object({
  id: z.string(),
  payment_source: z.object({ paypal: z.object({ email_address: z.string().optional() }).optional() }).optional(),
});

/**
 * Saves a PayPal account without a purchase, using PayPal's Payment Method
 * Tokens API: a setup token the buyer approves at PayPal, then exchanged for a
 * permanent payment token.
 */
export class PayPalMethodVault implements PaymentMethodVault {
  constructor(private readonly paypal: PayPalClient) {}

  async startSaving(input: { returnUrl: string; cancelUrl: string }) {
    try {
      const setup = setupSchema.parse(
        await this.paypal.post('/v3/vault/setup-tokens', {
          requestId: `proofstake-setup-${globalThis.crypto.randomUUID()}`,
          body: {
            payment_source: {
              paypal: {
                usage_type: 'MERCHANT',
                customer_type: 'CONSUMER',
                experience_context: {
                  brand_name: 'ProofStake',
                  shipping_preference: 'NO_SHIPPING',
                  return_url: input.returnUrl,
                  cancel_url: input.cancelUrl,
                },
              },
            },
          },
        }),
      );
      const approve = setup.links?.find((link) => link.rel === 'approve' || link.rel === 'payer-action');
      if (!approve) throw new DomainError('PAYMENT_FAILED', 'PayPal did not offer a way to approve saving the account.');
      // Only ever send the user to PayPal itself.
      const host = new URL(approve.href).hostname;
      if (host !== 'paypal.com' && !host.endsWith('.paypal.com')) {
        throw new DomainError('PAYMENT_FAILED', 'PayPal returned an unexpected approval address.');
      }
      return { setupId: setup.id, approveUrl: approve.href };
    } catch (error) {
      if (error instanceof PayPalApiError && error.status === 403) {
        // The app may place holds and save an account during a hold, but PayPal has not
        // (yet) granted it "save without a purchase". Point the user at the route that works.
        logServerError('paypal', `save PayPal accounts failed: ${error.message} (debug_id: ${error.debugId ?? 'none'})`);
        throw new DomainError(
          'PAYMENT_FAILED',
          'PayPal has not enabled saving an account from this screen for this app yet. You can still save yours while placing a hold: keep "Save this PayPal account" ticked on the hold screen.',
        );
      }
      throw toDomainError(error, 'save PayPal accounts');
    }
  }

  async finishSaving(setupId: string) {
    try {
      let token: z.infer<typeof paymentTokenSchema>;
      try {
        token = paymentTokenSchema.parse(
          await this.paypal.post('/v3/vault/payment-tokens', {
            requestId: `proofstake-token-${setupId}`,
            body: { payment_source: { token: { id: setupId, type: 'SETUP_TOKEN' } } },
          }),
        );
      } catch (error) {
        if (error instanceof PayPalApiError && [400, 404, 422].includes(error.status)) {
          logServerError('paypal', `saving the PayPal account was not confirmed: ${error.message}`);
          throw new DomainError(
            'PAYMENT_NOT_APPROVED',
            'PayPal did not confirm the account. Approve it on the PayPal page, then try again.',
          );
        }
        throw error;
      }
      return { id: token.id, label: token.payment_source?.paypal?.email_address };
    } catch (error) {
      throw toDomainError(error, 'save the PayPal account');
    }
  }
}
