import { createAppealsUseCases, type AppealsDeps } from './use-cases';

export type { CaptureRecord, Refunds, ReviewCase, ReviewRepository } from './ports';

export function createAppealsModule(deps: AppealsDeps) {
  const { openLowConfidenceCase, ...useCases } = createAppealsUseCases(deps);
  deps.bus.subscribe('ReviewRequested', (e) => openLowConfidenceCase(e.goalId, e.verdict));
  deps.bus.subscribe('StakeCaptured', (e) =>
    deps.reviews.saveCapture({ goalId: e.goalId, captureId: e.captureId, amount: e.amount }),
  );
  return useCases;
}
export type AppealsModule = ReturnType<typeof createAppealsModule>;
