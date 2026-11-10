import type { Money, Verdict } from '../shared';
import type { SettlementAction } from './policy';

/** The state of the hold as PayPal reports it. PayPal is the source of truth, not our database. */
export type HoldStatus = 'HELD' | 'PENDING' | 'VOIDED' | 'CAPTURED' | 'PARTIALLY_CAPTURED' | 'DENIED' | 'EXPIRED';

/** A payment method the buyer agreed to keep with the payment provider, for one-step holds later. */
export interface SavedMethodRef {
  /** the provider's token for the method; stays on the server */
  id: string;
  /** something the user recognises it by, such as the PayPal account email */
  label?: string;
}

export interface StakeHolds {
  /** `saveForLater`: ask the provider to keep the method the buyer approves with, if the buyer agrees. */
  createHold(input: {
    goalId: string;
    amount: Money;
    saveForLater?: boolean;
    /** Where the provider may send the buyer back to. Required by the provider when saving a method. */
    returnUrl?: string;
  }): Promise<{ orderId: string; approveUrl: string }>;
  confirmHold(orderId: string): Promise<{ authorizationId: string; amount: Money; savedMethod?: SavedMethodRef }>;
  /** Places the hold on a previously saved method. No approval step: the buyer agreed to this when saving it. */
  holdWithSavedMethod(input: {
    goalId: string;
    amount: Money;
    savedMethodId: string;
  }): Promise<{ orderId: string; authorizationId: string; amount: Money }>;
  release(authorizationId: string): Promise<void>;
  /** Always a final capture: whatever is not captured is released by PayPal. */
  capture(authorizationId: string, amount: Money): Promise<{ captureId: string }>;
  getHoldStatus(authorizationId: string): Promise<HoldStatus>;
}

export interface StakeRecord {
  goalId: string;
  /** the account that owns the goal */
  userId?: string;
  amount: Money;
  status: 'NOT_READY' | 'READY' | 'PENDING_APPROVAL' | 'HELD' | 'IN_REVIEW' | 'RELEASED' | 'CAPTURED';
  deadline: Date;
  /** a photo was uploaded and its verdict has not arrived yet */
  awaitingVerdict: boolean;
  /** the latest upload was the last one the goal allows */
  finalAttempt: boolean;
  /** a not-good-enough verdict the user may still improve on; settled if they accept it or the deadline passes */
  deferredVerdict?: Verdict;
  orderId?: string;
  authorizationId?: string;
  captureId?: string;
  capturedAmount?: Money;
  /** decided but not yet confirmed by PayPal; retried until it goes through */
  pendingAction?: SettlementAction;
  /** when the hold was placed, and when the money was finally released or captured */
  heldAt?: Date;
  settledAt?: Date;
  /** why the most recent attempt to carry out pendingAction failed, in words safe to show the user */
  lastError?: { at: Date; message: string };
  /** last status read back from PayPal after a write */
  holdStatus?: HoldStatus;
}

export interface StakeRepository {
  get(goalId: string): Promise<StakeRecord | null>;
  save(record: StakeRecord): Promise<void>;
  /** Stakes whose settlement was decided but has not gone through at PayPal yet. */
  listPending(): Promise<StakeRecord[]>;
}

export interface SavedMethod extends SavedMethodRef {
  userId: string;
  savedAt: Date;
}

/** Saving a payment method on its own, without placing a hold. The buyer approves it at the provider. */
export interface PaymentMethodVault {
  startSaving(input: { returnUrl: string; cancelUrl: string }): Promise<{ setupId: string; approveUrl: string }>;
  /** Call after the buyer approved. Fails if they did not. */
  finishSaving(setupId: string): Promise<SavedMethodRef>;
}

/** A "save my account" request the user started and has not finished approving yet. */
export interface PendingMethodSetup {
  userId: string;
  setupId: string;
  startedAt: Date;
}

export interface SavedMethodRepository {
  get(userId: string): Promise<SavedMethod | null>;
  save(method: SavedMethod): Promise<void>;
  delete(userId: string): Promise<void>;
  getPending(userId: string): Promise<PendingMethodSetup | null>;
  savePending(setup: PendingMethodSetup): Promise<void>;
  deletePending(userId: string): Promise<void>;
}
