import { usd, type Money, type Outcome } from '../shared';

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

export type SettlementInput =
  | {
      kind: 'VERDICT';
      outcome: Outcome;
      /** 0 to 1. A human reviewer's decision is passed with confidence 1. */
      confidence: number;
      /** 0 to 1. Only read when the outcome is PARTIAL. */
      fractionCompleted: number;
      stake: Money;
      confidenceThreshold?: number;
    }
  | { kind: 'NO_PROOF'; stake: Money };

export type SettlementAction =
  | { type: 'REQUEST_REVIEW' }
  | { type: 'RELEASE' }
  | { type: 'CAPTURE'; amount: Money; partial: boolean };

/**
 * The whole money policy. Pure: no clock, no I/O, no PayPal.
 * The AI never reaches this function's output; it only supplies outcome, confidence and fraction.
 */
export function decideSettlement(input: SettlementInput): SettlementAction {
  const { stake } = input;
  const captureAll: SettlementAction = { type: 'CAPTURE', amount: stake, partial: false };

  if (input.kind === 'NO_PROOF') return captureAll;

  const threshold = input.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  // NaN or out-of-range numbers are treated as "not confident", never as permission to move money.
  if (!(input.confidence >= threshold && input.confidence <= 1)) return { type: 'REQUEST_REVIEW' };

  switch (input.outcome) {
    case 'PASS':
      return { type: 'RELEASE' };
    case 'FAIL':
      return captureAll;
    case 'PARTIAL': {
      const f = input.fractionCompleted;
      if (!(f >= 0 && f <= 1)) return { type: 'REQUEST_REVIEW' };
      const cents = Math.round(stake.cents * (1 - f));
      // PayPal cannot capture $0.00, so a capture that rounds to nothing is a release.
      if (cents <= 0) return { type: 'RELEASE' };
      if (cents >= stake.cents) return captureAll;
      return { type: 'CAPTURE', amount: usd(cents), partial: true };
    }
  }
}
