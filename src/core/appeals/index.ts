import { createAppealsUseCases, type AppealsDeps } from './use-cases';

export { RECOMMENDATIONS } from './ports';
export type {
  CaptureRecord,
  CaseAdvice,
  CaseAdvisor,
  CaseBrief,
  Recommendation,
  Refunds,
  ReviewCase,
  ReviewRepository,
} from './ports';

export function createAppealsModule(deps: AppealsDeps) {
  const { openLowConfidenceCase, ...useCases } = createAppealsUseCases(deps);
  deps.bus.subscribe('ReviewRequested', (e) => openLowConfidenceCase(e.goalId, e.verdict));
  deps.bus.subscribe('StakeCaptured', (e) =>
    deps.reviews.saveCapture({ goalId: e.goalId, captureId: e.captureId, amount: e.amount }),
  );
  deps.bus.subscribe('StakePaidOut', async (e) => {
    const capture = await deps.reviews.getCapture(e.goalId);
    if (capture) await deps.reviews.saveCapture({ ...capture, paidOut: true });
  });
  return useCases;
}
export type AppealsModule = ReturnType<typeof createAppealsModule>;
