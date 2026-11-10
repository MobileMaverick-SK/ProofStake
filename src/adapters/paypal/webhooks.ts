import { z } from 'zod';
import { logServerError } from '../server-log';
import type { PayPalClient } from './client';

export interface WebhookEventEntry {
  id: string;
  type: string;
  /** the PayPal id the event is about (authorization, capture, refund or payout batch) */
  resourceId?: string;
  receivedAt: Date;
  /** what we did about it, in a few words */
  result: string;
}

export interface WebhookEventLog {
  has(eventId: string): Promise<boolean>;
  record(entry: WebhookEventEntry): Promise<void>;
  /** Newest first. */
  recent(limit: number): Promise<WebhookEventEntry[]>;
}

export class InMemoryWebhookEventLog implements WebhookEventLog {
  private readonly entries = new Map<string, WebhookEventEntry>();
  async has(eventId: string) {
    return this.entries.has(eventId);
  }
  async record(entry: WebhookEventEntry) {
    this.entries.set(entry.id, entry);
  }
  async recent(limit: number) {
    return [...this.entries.values()].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()).slice(0, limit);
  }
}

/** What the rest of the app does when PayPal reports a change. Each returns a few words for the log. */
export interface WebhookReactions {
  holdChanged(authorizationId: string): Promise<string>;
  payoutChanged(payoutBatchId: string): Promise<string>;
}

const eventSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource: z
    .object({
      id: z.string().optional(),
      payout_batch_id: z.string().optional(),
      batch_header: z.object({ payout_batch_id: z.string().optional() }).optional(),
      supplementary_data: z.object({ related_ids: z.object({ authorization_id: z.string().optional() }).optional() }).optional(),
    })
    .passthrough()
    .optional(),
});

const SIGNATURE_HEADERS = {
  auth_algo: 'paypal-auth-algo',
  cert_url: 'paypal-cert-url',
  transmission_id: 'paypal-transmission-id',
  transmission_sig: 'paypal-transmission-sig',
  transmission_time: 'paypal-transmission-time',
} as const;

/**
 * Receives PayPal webhook events. An event is only a hint that something
 * changed: after its signature is verified with PayPal, the app reads the
 * payment back from PayPal and acts on what it reads, never on the event's own
 * contents. Each event is handled once.
 */
export class PayPalWebhookReceiver {
  constructor(
    private readonly paypal: PayPalClient,
    /** The id PayPal gave this app's webhook. Empty when webhooks are not set up. */
    private readonly webhookId: string,
    private readonly log: WebhookEventLog,
    private readonly reactions: WebhookReactions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get configured(): boolean {
    return Boolean(this.webhookId) && this.paypal.configured;
  }

  /** Returns the HTTP status to answer with. Anything but 2xx makes PayPal send the event again later. */
  async receive(input: { headers: { get(name: string): string | null }; rawBody: string }): Promise<number> {
    if (!this.configured) return 503;

    let event: z.infer<typeof eventSchema>;
    try {
      event = eventSchema.parse(JSON.parse(input.rawBody));
    } catch {
      return 400;
    }
    const signature: Record<string, string> = {};
    for (const [field, header] of Object.entries(SIGNATURE_HEADERS)) {
      const value = input.headers.get(header);
      if (!value) return 400;
      signature[field] = value;
    }

    try {
      if (!(await this.verify(signature, input.rawBody))) {
        logServerError('paypal-webhook', `signature check failed for event ${event.id} (${event.event_type})`);
        return 401;
      }
      if (await this.log.has(event.id)) return 200;

      const resource = event.resource ?? {};
      let resourceId = resource.id;
      let result: string;
      const type = event.event_type;
      if (type.startsWith('PAYMENT.AUTHORIZATION.')) {
        result = resource.id ? await this.reactions.holdChanged(resource.id) : 'no authorization id';
      } else if (type.startsWith('PAYMENT.CAPTURE.')) {
        const authorizationId = resource.supplementary_data?.related_ids?.authorization_id;
        result = authorizationId ? await this.reactions.holdChanged(authorizationId) : 'noted';
      } else if (type.startsWith('PAYMENT.PAYOUTSBATCH.') || type.startsWith('PAYMENT.PAYOUTS-ITEM.')) {
        resourceId = resource.batch_header?.payout_batch_id ?? resource.payout_batch_id;
        result = resourceId ? await this.reactions.payoutChanged(resourceId) : 'no payout id';
      } else {
        result = 'not an event this app acts on';
      }
      await this.log.record({ id: event.id, type, resourceId, receivedAt: this.now(), result });
      return 200;
    } catch (error) {
      // Not recorded as handled, so PayPal's retry gets another chance.
      logServerError('paypal-webhook', `event ${event.id} (${event.event_type}) failed: ${error instanceof Error ? error.message : String(error)}`);
      return 500;
    }
  }

  /**
   * Asks PayPal whether it really sent this. The event must go back exactly as
   * it arrived, so the raw text is spliced into the request instead of being
   * parsed and written out again (which can change it and fail the check).
   */
  private async verify(signature: Record<string, string>, rawBody: string): Promise<boolean> {
    const fields = JSON.stringify({ ...signature, webhook_id: this.webhookId });
    const answer = (await this.paypal.post('/v1/notifications/verify-webhook-signature', {
      rawBody: `${fields.slice(0, -1)},"webhook_event":${rawBody}}`,
    })) as { verification_status?: unknown } | null;
    return answer?.verification_status === 'SUCCESS';
  }
}
