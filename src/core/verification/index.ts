import { createVerificationUseCases, type VerificationDeps } from './use-cases';

export type { ProofVerifier, VerdictRepository } from './ports';
export { normalizeVerdict, unverifiableVerdict } from './use-cases';

export function createVerificationModule(deps: VerificationDeps) {
  const { verifyProof, ...useCases } = createVerificationUseCases(deps);
  deps.bus.subscribe('ProofSubmitted', async (e) => {
    await verifyProof(e);
  });
  return useCases;
}
export type VerificationModule = ReturnType<typeof createVerificationModule>;
