import { randomChallengeCode, type CodeGenerator } from './challenge-code';
import type { ProofSlot } from './ports';
import { createProofIntakeUseCases, type ProofIntakeDeps } from './use-cases';

export { CHALLENGE_CODE_LENGTH, randomChallengeCode, type CodeGenerator } from './challenge-code';
export type { ProofRepository, ProofSlot, ProofStore } from './ports';
export { ALLOWED_PROOF_TYPES, MAX_PROOF_ATTEMPTS, MAX_PROOF_BYTES } from './use-cases';

export function createProofIntakeModule(deps: ProofIntakeDeps & { generateCode?: CodeGenerator }) {
  const { proofs, bus } = deps;
  const generateCode = deps.generateCode ?? randomChallengeCode;

  async function update(goalId: string, change: (slot: ProofSlot) => ProofSlot | null): Promise<void> {
    const slot = await proofs.get(goalId);
    if (!slot) return;
    const next = change(slot);
    if (next) await proofs.save(next);
  }
  /** The deadline closes a slot that is waiting for a photo; a photo already being checked is left to finish. */
  const closeIfOpen = (goalId: string) =>
    update(goalId, (slot) => (slot.status === 'OPEN' ? { ...slot, status: 'CLOSED' } : null));
  /** Once the money has settled nothing more can be uploaded. */
  const close = (goalId: string) =>
    update(goalId, (slot) => (slot.status !== 'CLOSED' ? { ...slot, status: 'CLOSED' } : null));

  bus.subscribe('GoalCreated', (e) =>
    proofs.save({ goalId: e.goalId, deadline: e.deadline, challengeCode: generateCode(), status: 'NOT_OPEN' }),
  );
  bus.subscribe('RulesAccepted', (e) => update(e.goalId, (slot) => ({ ...slot, rules: e.rules })));
  bus.subscribe('StakeHeld', (e) =>
    update(e.goalId, (slot) => (slot.status === 'NOT_OPEN' ? { ...slot, status: 'OPEN' } : null)),
  );
  bus.subscribe('RetryAllowed', (e) =>
    update(e.goalId, (slot) => (slot.status === 'SUBMITTED' ? { ...slot, status: 'OPEN' } : null)),
  );
  bus.subscribe('DeadlinePassed', (e) => closeIfOpen(e.goalId));
  bus.subscribe('StakeCaptured', (e) => close(e.goalId));
  bus.subscribe('StakeReleased', (e) => close(e.goalId));

  return createProofIntakeUseCases(deps);
}
export type ProofIntakeModule = ReturnType<typeof createProofIntakeModule>;
