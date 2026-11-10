import { z } from 'zod';

export const outcomeSchema = z.enum(['PASS', 'PARTIAL', 'FAIL']);
export type Outcome = z.infer<typeof outcomeSchema>;

export const verdictSchema = z.object({
  outcome: outcomeSchema,
  fractionCompleted: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  checks: z.array(
    z.object({
      checkId: z.string(),
      passed: z.boolean(),
      reason: z.string().max(500),
    }),
  ),
  codeFound: z.boolean(),
});
export type Verdict = z.infer<typeof verdictSchema>;

/** What a human reviewer decides for a low-confidence case. Carries no confidence: a human is final. */
export const reviewDecisionSchema = z.object({
  outcome: outcomeSchema,
  fractionCompleted: z.number().min(0).max(1),
});
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
