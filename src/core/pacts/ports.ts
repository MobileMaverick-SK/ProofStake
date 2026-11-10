import type { Money, ProofRules } from '../shared';

/** Sends captured money on to a person. Deliberately separate from StakeHolds and Refunds: it can pay out, and nothing else. */
export interface Payouts {
  /** Idempotent per goal: sending twice for the same goal pays once. */
  send(input: { goalId: string; amount: Money; recipientEmail: string; note: string }): Promise<{ payoutId: string }>;
  getStatus(payoutId: string): Promise<PayoutStatus>;
}

/** PROCESSING: on its way. UNCLAIMED: the recipient has no account yet. PAID and FAILED are final. */
export type PayoutStatus = 'PROCESSING' | 'PAID' | 'UNCLAIMED' | 'FAILED';

export interface PactPayout {
  /**
   * SCHEDULED: waits for the appeal window to close. ON_HOLD: an appeal is open.
   * SENT: handed to the payment provider. CANCELLED: the appeal was upheld and the user refunded.
   */
  status: 'SCHEDULED' | 'ON_HOLD' | 'SENT' | 'CANCELLED';
  amount: Money;
  /** the earliest moment the money may be sent */
  dueAt: Date;
  payoutId?: string;
  sentAt?: Date;
  /** what the payment provider last said about a sent payout */
  providerStatus?: PayoutStatus;
  /** why the most recent attempt to send failed, in words safe to show */
  lastError?: { at: Date; message: string };
}

/** An agreement that a lost stake goes to a person the user chose, instead of the charity pool. */
export interface Pact {
  goalId: string;
  userId: string;
  ownerName: string;
  partnerName: string;
  partnerEmail: string;
  /** The secret in the invite link. Whoever holds it can answer the invite; it gives no other access. */
  token: string;
  /** What the partner is shown. Copied here because modules do not read each other's storage. */
  goalText: string;
  deadline: Date;
  stake: Money;
  rules?: ProofRules;
  status: 'INVITED' | 'ACCEPTED' | 'DECLINED';
  /** the PayPal email the partner asked to be paid at */
  payoutEmail?: string;
  respondedAt?: Date;
  createdAt: Date;
  /** one short message from the partner, shown to the user */
  nudge?: { text: string; at: Date };
  /** PENDING: no hold yet. HELD: hold in place. KEPT: user kept the money. LOST: captured. REFUNDED: appeal upheld. */
  outcome: 'PENDING' | 'HELD' | 'KEPT' | 'LOST' | 'REFUNDED';
  payout?: PactPayout;
}

export interface PactRepository {
  get(goalId: string): Promise<Pact | null>;
  getByToken(token: string): Promise<Pact | null>;
  save(pact: Pact): Promise<void>;
  /** Pacts with a payout that is not finished: waiting, on hold, or sent without a final status. */
  listOpenPayouts(): Promise<Pact[]>;
}

/** True while the scheduler still has something to do for this payout. */
export function isPayoutOpen(payout: PactPayout | undefined): boolean {
  if (!payout) return false;
  if (payout.status === 'SCHEDULED' || payout.status === 'ON_HOLD') return true;
  return payout.status === 'SENT' && payout.providerStatus !== 'PAID' && payout.providerStatus !== 'FAILED';
}
