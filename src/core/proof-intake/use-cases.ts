import { DomainError, newId, notFound, type Clock, type EventBus } from '../shared';
import type { ProofRepository, ProofSlot, ProofStore } from './ports';

export const ALLOWED_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_PROOF_BYTES = 8 * 1024 * 1024;
/** A goal accepts this many photos in total, so a rejected proof can be redone but the AI cannot be brute-forced. */
export const MAX_PROOF_ATTEMPTS = 3;

export interface ProofIntakeDeps {
  proofs: ProofRepository;
  store: ProofStore;
  bus: EventBus;
  clock: Clock;
}

export function createProofIntakeUseCases({ proofs, store, bus, clock }: ProofIntakeDeps) {
  async function load(goalId: string): Promise<ProofSlot> {
    const slot = await proofs.get(goalId);
    if (!slot) throw notFound('Proof slot for goal', goalId);
    return slot;
  }

  return {
    getProofSlot: load,

    async submitProof(input: { goalId: string; file: Buffer; mimeType: string }): Promise<ProofSlot> {
      const slot = await load(input.goalId);
      const attempt = (slot.attempts ?? 0) + 1;
      if (slot.status === 'SUBMITTED') {
        throw new DomainError('CONFLICT', 'Your last photo is still being checked');
      }
      if (attempt > MAX_PROOF_ATTEMPTS) {
        throw new DomainError('CONFLICT', `A goal accepts at most ${MAX_PROOF_ATTEMPTS} photos`);
      }
      if (slot.status === 'CLOSED') {
        throw new DomainError('CONFLICT', 'This goal is finished and no longer accepts proof');
      }
      if (slot.status !== 'OPEN' || !slot.rules) {
        throw new DomainError('CONFLICT', 'This goal is not accepting proof');
      }
      const now = clock.now();
      if (now.getTime() > slot.deadline.getTime()) {
        throw new DomainError('DEADLINE_PASSED', 'The deadline has passed');
      }
      if (!(ALLOWED_PROOF_TYPES as readonly string[]).includes(input.mimeType)) {
        throw new DomainError('VALIDATION', 'Proof must be a JPEG, PNG or WebP image');
      }
      if (input.file.byteLength === 0 || input.file.byteLength > MAX_PROOF_BYTES) {
        throw new DomainError('VALIDATION', 'Proof must be an image of at most 8 MB');
      }

      const { url } = await store.save(input.file, input.mimeType);
      const submitted: ProofSlot = {
        ...slot,
        status: 'SUBMITTED',
        attempts: attempt,
        proof: { proofId: newId('proof'), url, mimeType: input.mimeType, submittedAt: now },
      };
      await proofs.save(submitted);
      await bus.publish({
        type: 'ProofSubmitted',
        goalId: slot.goalId,
        proofId: submitted.proof!.proofId,
        proofUrl: url,
        challengeCode: slot.challengeCode,
        rules: slot.rules,
        attempt,
        finalAttempt: attempt >= MAX_PROOF_ATTEMPTS,
      });
      return submitted;
    },
  };
}
