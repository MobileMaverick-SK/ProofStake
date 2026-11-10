import { describe, expect, it } from 'vitest';
import { SECOND_OPINION_CHECK_ID, SecondOpinionVerifier } from '../src/adapters/ai';
import { SAMPLE_RULES } from '../src/adapters/fakes';
import { decideSettlement } from '../src/core/settlement';
import { usd, type Verdict } from '../src/core/shared';

const INPUT = { proofUrl: '/api/proofs/x.jpg', rules: SAMPLE_RULES, challengeCode: 'K7M4QX' };
const verdict = (overrides: Partial<Verdict>): Verdict => ({ outcome: 'FAIL', fractionCompleted: 0, confidence: 0.95, checks: [], codeFound: true, ...overrides });

function pair(first: Verdict, second: Verdict | null) {
  let asked = 0;
  const verifier = new SecondOpinionVerifier(
    { verify: async () => first },
    { model: 'second-model', tryVerify: async () => (asked++, second) },
  );
  return { verify: () => verifier.verify(INPUT), asked: () => asked };
}
const action = (v: Verdict) => decideSettlement({ kind: 'VERDICT', outcome: v.outcome, confidence: v.confidence, fractionCompleted: v.fractionCompleted, stake: usd(2000) }).type;
const note = (v: Verdict) => v.checks.find((check) => check.checkId === SECOND_OPINION_CHECK_ID);

describe('second opinion', () => {
  it('a charge both models agree on goes ahead, and says so', async () => {
    const { verify } = pair(verdict({}), verdict({ confidence: 0.9 }));
    const result = await verify();
    expect(action(result)).toBe('CAPTURE');
    expect(note(result)).toMatchObject({ passed: true });
    expect(note(result)!.reason).toContain('second-model');
  });

  it('a charge the second model disagrees with goes to a person instead', async () => {
    const { verify } = pair(verdict({}), verdict({ outcome: 'PASS', fractionCompleted: 1 }));
    const result = await verify();
    expect(result.outcome).toBe('FAIL');
    expect(action(result)).toBe('REQUEST_REVIEW');
    expect(note(result)).toMatchObject({ passed: false });
    expect(note(result)!.reason).toContain('"goal met"');
  });

  it('partial verdicts must be close: 50% against 90% is a disagreement, 50% against 60% is not', async () => {
    const half = verdict({ outcome: 'PARTIAL', fractionCompleted: 0.5 });
    expect(action(await pair(half, verdict({ outcome: 'PARTIAL', fractionCompleted: 0.9 })).verify())).toBe('REQUEST_REVIEW');
    expect(action(await pair(half, verdict({ outcome: 'PARTIAL', fractionCompleted: 0.6 })).verify())).toBe('CAPTURE');
  });

  it('a second model that could not tell also sends it to a person', async () => {
    const result = await pair(verdict({}), verdict({ confidence: 0.2 })).verify();
    expect(action(result)).toBe('REQUEST_REVIEW');
    expect(note(result)!.reason).toContain('could not tell');
  });

  it('a clear pass is not second-guessed, but a pass that only just cleared the threshold is', async () => {
    const clear = pair(verdict({ outcome: 'PASS', fractionCompleted: 1, confidence: 0.95 }), verdict({}));
    expect(action(await clear.verify())).toBe('RELEASE');
    expect(clear.asked()).toBe(0);

    const thin = pair(verdict({ outcome: 'PASS', fractionCompleted: 1, confidence: 0.82 }), verdict({}));
    expect(action(await thin.verify())).toBe('REQUEST_REVIEW');
    expect(thin.asked()).toBe(1);
  });

  it('is not asked when the first verdict is already going to a person', async () => {
    const unsure = pair(verdict({ confidence: 0.4 }), verdict({ outcome: 'PASS' }));
    const result = await unsure.verify();
    expect(unsure.asked()).toBe(0);
    expect(result.confidence).toBe(0.4);
  });

  it('can only make a verdict more cautious, never more confident', async () => {
    const result = await pair(verdict({ confidence: 0.85 }), verdict({ confidence: 1 })).verify();
    expect(result.confidence).toBe(0.85);
  });

  it('when the second model is unavailable, the first verdict stands unchanged', async () => {
    const first = verdict({});
    expect(await pair(first, null).verify()).toEqual(first);
  });
});
