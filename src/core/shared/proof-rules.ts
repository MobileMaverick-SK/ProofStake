import { z } from 'zod';

/** One thing the proof photo must show. Written by the AI, accepted by the user. */
export const proofCheckSchema = z.object({
  id: z.string().min(1).max(40),
  description: z.string().min(1).max(300),
  required: z.boolean(),
});

export const proofRulesSchema = z.object({
  checks: z.array(proofCheckSchema).min(1).max(8),
  /** How partial completion is measured, if the goal can be partly met at all. */
  partialCompletion: z.object({
    measurable: z.boolean(),
    description: z.string().max(300).optional(),
  }),
});

export type ProofCheck = z.infer<typeof proofCheckSchema>;
export type ProofRules = z.infer<typeof proofRulesSchema>;
