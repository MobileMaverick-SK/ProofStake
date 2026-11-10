import { z } from 'zod';
import type { HoldStatus, StakeHolds } from '../../core/settlement';
import { DomainError, fromDecimalString, toDecimalString, type Money } from '../../core/shared';
import { PayPalApiError, type PayPalClient } from './client';
import { logServerError } from '../server-log';
import { toDomainError } from './errors';

const amountSchema = z.object({ currency_code: z.string(), value: z.string() });
const authorizationSchema = z.object({ id: z.string(), status: z.string(), amount: amountSchema.optional() });
const orderSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  payment_source: z
    .object({
      paypal: z
        .object({
          email_address: z.string().optional(),
          attributes: z
            .object({ vault: z.object({ id: z.string().optional(), status: z.string().optional() }).optional() })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  links: z.array(z.object({ rel: z.string(), href: z.string() })).optional(),
  purchase_units: z
    .array(z.object({ payments: z.object({ authorizations: z.array(authorizationSchema).optional() }).optional() }))
    .optional(),
});
const captureSchema = z.object({ id: z.string(), status: z.string() });

const toPayPalAmount = (money: Money) => ({ currency_code: money.currency, value: toDecimalString(money) });

function fromPayPalAmount(amount: z.infer<typeof amountSchema>): Money {
  if (amount.currency_code !== 'USD') throw new DomainError('AMOUNT_MISMATCH', 'PayPal answered in an unexpected currency');
  return fromDecimalString(amount.value, 'USD');
}

const HOLD_STATUS: Record<string, HoldStatus> = {
  CREATED: 'HELD',
  PENDING: 'PENDING',
  VOIDED: 'VOIDED',
  CAPTURED: 'CAPTURED',
  PARTIALLY_CAPTURED: 'PARTIALLY_CAPTURED',
  DENIED: 'DENIED',
};

/** StakeHolds against the PayPal sandbox: Orders v2 to place the hold, Payments v2 to void or capture it. */
const HOUR_MS = 60 * 60 * 1000;
const EXPERIENCE = { brand_name: 'ProofStake', shipping_preference: 'NO_SHIPPING', user_action: 'CONTINUE' };

export class PayPalStakeHolds implements StakeHolds {
  constructor(
    private readonly paypal: PayPalClient,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Idempotency key for creating an order. It changes every hour, because an
   * unapproved PayPal order expires after a few hours and must then be replaced
   * by a new one rather than replayed.
   */
  private orderRequestId(kind: string, goalId: string, amount: Money): string {
    return `proofstake-${kind}-${goalId}-${amount.cents}-${Math.floor(this.now() / HOUR_MS)}`;
  }

  private purchaseUnits(goalId: string, amount: Money) {
    return [
      {
        reference_id: goalId,
        custom_id: goalId,
        description: 'ProofStake commitment stake (hold only)',
        amount: toPayPalAmount(amount),
      },
    ];
  }

  async createHold(input: { goalId: string; amount: Money; saveForLater?: boolean; returnUrl?: string }) {
    // PayPal refuses to save an account unless it is told where the buyer returns to.
    const wantsSave = Boolean(input.saveForLater && input.returnUrl);
    const experience = input.returnUrl
      ? { ...EXPERIENCE, return_url: input.returnUrl, cancel_url: input.returnUrl }
      : EXPERIENCE;
    const create = (save: boolean) =>
      this.paypal.post('/v2/checkout/orders', {
        requestId: this.orderRequestId(save ? 'hold-save' : 'hold', input.goalId, input.amount),
        body: {
          intent: 'AUTHORIZE',
          purchase_units: this.purchaseUnits(input.goalId, input.amount),
          payment_source: {
            paypal: {
              experience_context: experience,
              // Ask PayPal to keep this account for later holds, once the buyer has approved this one.
              ...(save
                ? { attributes: { vault: { store_in_vault: 'ON_SUCCESS', usage_type: 'MERCHANT', customer_type: 'CONSUMER' } } }
                : {}),
            },
          },
        },
      });
    try {
      let raw: unknown;
      try {
        raw = await create(wantsSave);
      } catch (error) {
        // Saving a payment method is an optional PayPal feature. If this app is not
        // enabled for it, place an ordinary hold instead of failing the user.
        const refused = error instanceof PayPalApiError && [400, 403, 422].includes(error.status);
        if (!wantsSave || !refused) throw error;
        logServerError('paypal', `saving the payment method was refused, placing an ordinary hold: ${error.message}`);
        raw = await create(false);
      }
      const order = orderSchema.parse(raw);
      const approve = order.links?.find((link) => link.rel === 'payer-action' || link.rel === 'approve');
      return {
        orderId: order.id,
        approveUrl: approve?.href ?? `https://www.sandbox.paypal.com/checkoutnow?token=${order.id}`,
      };
    } catch (error) {
      throw toDomainError(error, 'create the hold');
    }
  }

  async confirmHold(orderId: string) {
    try {
      let order: z.infer<typeof orderSchema>;
      try {
        order = orderSchema.parse(
          await this.paypal.post(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
            requestId: `proofstake-authorize-${orderId}`,
          }),
        );
      } catch (error) {
        // A retry after a lost response: the hold exists, so read it instead of failing.
        if (!(error instanceof PayPalApiError && error.has('ORDER_ALREADY_AUTHORIZED'))) throw error;
        order = orderSchema.parse(await this.paypal.get(`/v2/checkout/orders/${encodeURIComponent(orderId)}`));
      }

      let authorization = order.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (!authorization) throw new DomainError('PAYMENT_FAILED', 'PayPal did not return an authorization for this order.');
      if (!authorization.amount) authorization = await this.readAuthorization(authorization.id);
      if (authorization.status === 'DENIED' || authorization.status === 'VOIDED') {
        throw new DomainError('PAYMENT_FAILED', 'PayPal declined the hold. No money was held.');
      }
      if (!authorization.amount) throw new DomainError('PAYMENT_FAILED', 'PayPal did not report the held amount.');
      return {
        authorizationId: authorization.id,
        amount: fromPayPalAmount(authorization.amount),
        savedMethod: await this.savedMethodOf(order),
      };
    } catch (error) {
      throw toDomainError(error, 'place the hold');
    }
  }

  /** The saved-method token PayPal issued for this order, if the buyer agreed to save their account. */
  private async savedMethodOf(order: z.infer<typeof orderSchema>) {
    let wallet = order.payment_source?.paypal;
    if (!wallet?.attributes?.vault) return undefined;
    if (!wallet.attributes.vault.id) {
      // PayPal sometimes finishes saving just after the authorization: look once more.
      try {
        const again = orderSchema.parse(await this.paypal.get(`/v2/checkout/orders/${encodeURIComponent(order.id)}`));
        wallet = again.payment_source?.paypal ?? wallet;
      } catch {
        return undefined;
      }
    }
    const id = wallet.attributes?.vault?.id;
    return id ? { id, label: wallet.email_address } : undefined;
  }

  async holdWithSavedMethod(input: { goalId: string; amount: Money; savedMethodId: string }) {
    try {
      let order: z.infer<typeof orderSchema>;
      try {
        order = orderSchema.parse(
          await this.paypal.post('/v2/checkout/orders', {
            requestId: this.orderRequestId('hold-saved', input.goalId, input.amount),
            body: {
              intent: 'AUTHORIZE',
              purchase_units: this.purchaseUnits(input.goalId, input.amount),
              payment_source: { paypal: { vault_id: input.savedMethodId } },
            },
          }),
        );
      } catch (error) {
        if (error instanceof PayPalApiError && [400, 403, 404, 422].includes(error.status)) {
          logServerError('paypal', `hold on the saved account was refused: ${error.message}`);
          throw new DomainError('PAYMENT_NOT_APPROVED', 'Your saved PayPal account could not be used. Use the PayPal button instead.');
        }
        throw error;
      }
      let authorization = order.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (!authorization && order.status === 'APPROVED') {
        // Approved by the saved method but not yet authorized: finish it the usual way.
        const confirmed = await this.confirmHold(order.id);
        return { orderId: order.id, authorizationId: confirmed.authorizationId, amount: confirmed.amount };
      }
      if (!authorization || authorization.status === 'DENIED' || authorization.status === 'VOIDED') {
        throw new DomainError('PAYMENT_NOT_APPROVED', 'PayPal needs you to approve this hold yourself. Use the PayPal button.');
      }
      if (!authorization.amount) authorization = await this.readAuthorization(authorization.id);
      if (!authorization.amount) throw new DomainError('PAYMENT_FAILED', 'PayPal did not report the held amount.');
      return { orderId: order.id, authorizationId: authorization.id, amount: fromPayPalAmount(authorization.amount) };
    } catch (error) {
      throw toDomainError(error, 'place the hold on the saved account');
    }
  }

  async release(authorizationId: string) {
    try {
      await this.paypal.post(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, {
        requestId: `proofstake-void-${authorizationId}`,
      });
    } catch (error) {
      if (error instanceof PayPalApiError && error.has('PREVIOUSLY_VOIDED')) return; // already released
      throw toDomainError(error, 'release the hold');
    }
  }

  async capture(authorizationId: string, amount: Money) {
    try {
      const capture = captureSchema.parse(
        await this.paypal.post(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, {
          requestId: `proofstake-capture-${authorizationId}`,
          body: { amount: toPayPalAmount(amount), final_capture: true },
        }),
      );
      if (capture.status === 'DECLINED' || capture.status === 'FAILED') {
        throw new DomainError('PAYMENT_FAILED', 'PayPal declined the capture.');
      }
      return { captureId: capture.id };
    } catch (error) {
      throw toDomainError(error, 'capture the stake');
    }
  }

  async getHoldStatus(authorizationId: string): Promise<HoldStatus> {
    try {
      const authorization = await this.readAuthorization(authorizationId);
      return HOLD_STATUS[authorization.status] ?? 'PENDING';
    } catch (error) {
      throw toDomainError(error, 'read the hold');
    }
  }

  private async readAuthorization(authorizationId: string) {
    return authorizationSchema.parse(
      await this.paypal.get(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`),
    );
  }
}
