import type { CaseAdvice, CaseAdvisor, CaseBrief } from '../../core/appeals';

export class FakeCaseAdvisor implements CaseAdvisor {
  readonly briefs: CaseBrief[] = [];
  next: Omit<CaseAdvice, 'at'> = {
    recommendation: 'UNSURE',
    confidence: 0.5,
    summary: 'Nothing conclusive.',
    reasons: [],
    steps: [],
    model: 'fake',
  };

  async advise(brief: CaseBrief) {
    this.briefs.push(brief);
    return structuredClone(this.next);
  }
}
