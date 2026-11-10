import type { ProofRules, Verdict } from '../../core/shared';
import type { ProofVerifier } from '../../core/verification';

export const SECOND_OPINION_CHECK_ID = 'second-opinion';

/** Two readings of the same photo agree if the outcome matches and the share of work done is close. */
const MAX_FRACTION_GAP = 0.25;
/** A verdict this close above the threshold is too thin to move money on by itself. */
const BORDERLINE_MARGIN = 0.1;
const UNSURE = 0.5;

interface SecondReader {
  readonly model: string;
  tryVerify(input: { proofUrl: string; rules: ProofRules; challengeCode: string }): Promise<Verdict | null>;
}

const LABEL: Record<Verdict['outcome'], string> = { PASS: 'goal met', PARTIAL: 'partly met', FAIL: 'not met' };

/**
 * Asks a second, different model to read the photo before a verdict is allowed
 * to cost the user money, or when the first verdict only just cleared the
 * confidence threshold. If the two readings disagree, confidence is lowered so
 * the settlement policy sends the case to a human instead of moving money.
 *
 * The second model can only make the result more cautious, never less: it
 * cannot turn an unsure verdict into a confident one.
 */
export class SecondOpinionVerifier implements ProofVerifier {
  constructor(
    private readonly first: ProofVerifier,
    private readonly second: SecondReader,
    private readonly confidenceThreshold = 0.8,
  ) {}

  async verify(input: { proofUrl: string; rules: ProofRules; challengeCode: string }): Promise<Verdict> {
    const verdict = await this.first.verify(input);
    // Already on its way to a human reviewer: a second reading would change nothing.
    if (verdict.confidence < this.confidenceThreshold) return verdict;
    // A clear pass releases the user's own money. Nothing is charged, so there is nothing to double-check.
    if (verdict.outcome === 'PASS' && verdict.confidence >= this.confidenceThreshold + BORDERLINE_MARGIN) return verdict;

    const other = await this.second.tryVerify(input);
    // The second model is unavailable: the first verdict stands as it would have without this check.
    if (!other) return verdict;

    const agrees =
      other.confidence >= UNSURE &&
      other.outcome === verdict.outcome &&
      Math.abs(other.fractionCompleted - verdict.fractionCompleted) <= MAX_FRACTION_GAP;
    if (agrees) {
      return {
        ...verdict,
        checks: [
          ...verdict.checks,
          {
            checkId: SECOND_OPINION_CHECK_ID,
            passed: true,
            reason: `A second AI model (${this.second.model}) read the photo independently and reached the same result.`,
          },
        ],
      };
    }
    const reading =
      other.confidence < UNSURE
        ? 'could not tell'
        : `read it as "${LABEL[other.outcome]}"${other.outcome === 'PARTIAL' ? ` (${Math.round(other.fractionCompleted * 100)}% done)` : ''}`;
    return {
      ...verdict,
      // Below the threshold, whatever it is set to: a person decides.
      confidence: Math.min(verdict.confidence, UNSURE, this.confidenceThreshold - 0.01),
      checks: [
        ...verdict.checks,
        {
          checkId: SECOND_OPINION_CHECK_ID,
          passed: false,
          reason: `A second AI model (${this.second.model}) ${reading}, where the first read "${LABEL[verdict.outcome]}". The two disagree, so a person will decide.`,
        },
      ],
    };
  }
}
