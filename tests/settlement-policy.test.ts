import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIDENCE_THRESHOLD, decideSettlement, type SettlementInput } from '../src/core/settlement';
import { usd, type Outcome } from '../src/core/shared';

const stake = usd(2000);
const verdict = (outcome: Outcome, fractionCompleted: number, confidence = 0.95, extra: object = {}): SettlementInput => ({
  kind: 'VERDICT',
  outcome,
  fractionCompleted,
  confidence,
  stake,
  ...extra,
});

describe('settlement policy', () => {
  it('defaults the confidence threshold to 0.8', () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.8);
  });

  describe('confidence below the threshold', () => {
    it.each<Outcome>(['PASS', 'PARTIAL', 'FAIL'])('requests review for %s and moves no money', (outcome) => {
      expect(decideSettlement(verdict(outcome, 0.5, 0.79))).toEqual({ type: 'REQUEST_REVIEW' });
    });

    it('treats confidence exactly at the threshold as confident', () => {
      expect(decideSettlement(verdict('PASS', 1, 0.8))).toEqual({ type: 'RELEASE' });
    });

    it('honours a custom threshold', () => {
      expect(decideSettlement(verdict('PASS', 1, 0.85, { confidenceThreshold: 0.9 }))).toEqual({
        type: 'REQUEST_REVIEW',
      });
      expect(decideSettlement(verdict('FAIL', 0, 0.6, { confidenceThreshold: 0.5 }))).toEqual({
        type: 'CAPTURE',
        amount: stake,
        partial: false,
      });
    });

    it.each([Number.NaN, -0.1, 1.5, Number.POSITIVE_INFINITY])(
      'never moves money on a nonsense confidence (%s)',
      (confidence) => {
        expect(decideSettlement(verdict('FAIL', 0, confidence))).toEqual({ type: 'REQUEST_REVIEW' });
      },
    );
  });

  it('PASS releases the hold', () => {
    expect(decideSettlement(verdict('PASS', 1))).toEqual({ type: 'RELEASE' });
  });

  it('FAIL captures the full stake', () => {
    expect(decideSettlement(verdict('FAIL', 0))).toEqual({ type: 'CAPTURE', amount: stake, partial: false });
  });

  it('FAIL ignores whatever fraction the model reported', () => {
    expect(decideSettlement(verdict('FAIL', 0.9))).toEqual({ type: 'CAPTURE', amount: stake, partial: false });
  });

  it('no proof at the deadline captures the full stake', () => {
    expect(decideSettlement({ kind: 'NO_PROOF', stake })).toEqual({ type: 'CAPTURE', amount: stake, partial: false });
  });

  describe('PARTIAL', () => {
    it.each([
      [0.75, 500],
      [0.5, 1000],
      [0.25, 1500],
      [0.1, 1800],
    ])('with fraction %f captures %i cents of a $20.00 stake', (fraction, cents) => {
      expect(decideSettlement(verdict('PARTIAL', fraction))).toEqual({
        type: 'CAPTURE',
        amount: usd(cents),
        partial: true,
      });
    });

    it('rounds to the nearest cent', () => {
      const odd = (stakeCents: number, fraction: number) =>
        decideSettlement({ ...verdict('PARTIAL', fraction), stake: usd(stakeCents) });
      expect(odd(1999, 1 / 3)).toEqual({ type: 'CAPTURE', amount: usd(1333), partial: true }); // 1332.67
      expect(odd(1001, 0.5)).toEqual({ type: 'CAPTURE', amount: usd(501), partial: true }); // 500.5
      expect(odd(333, 0.7)).toEqual({ type: 'CAPTURE', amount: usd(100), partial: true }); // 99.9
    });

    it('releases when the capture would round to zero, because PayPal cannot capture $0.00', () => {
      expect(decideSettlement(verdict('PARTIAL', 1))).toEqual({ type: 'RELEASE' });
      expect(decideSettlement({ ...verdict('PARTIAL', 0.999), stake: usd(100) })).toEqual({ type: 'RELEASE' });
    });

    it('is a full, non-partial capture when nothing was completed', () => {
      expect(decideSettlement(verdict('PARTIAL', 0))).toEqual({ type: 'CAPTURE', amount: stake, partial: false });
    });

    it.each([Number.NaN, -0.2, 1.2])('requests review on a nonsense fraction (%s)', (fraction) => {
      expect(decideSettlement(verdict('PARTIAL', fraction))).toEqual({ type: 'REQUEST_REVIEW' });
    });

    it('never captures more than the stake or a fractional cent', () => {
      for (let stakeCents = 100; stakeCents <= 5000; stakeCents += 137) {
        for (let f = 0; f <= 1; f += 0.01) {
          const action = decideSettlement({ ...verdict('PARTIAL', f), stake: usd(stakeCents) });
          if (action.type !== 'CAPTURE') continue;
          expect(Number.isInteger(action.amount.cents)).toBe(true);
          expect(action.amount.cents).toBeGreaterThan(0);
          expect(action.amount.cents).toBeLessThanOrEqual(stakeCents);
        }
      }
    });
  });
});
