import type { GoalDraft, GoalDrafter, GoalDraftRequest } from '../../core/goals';

export class FakeGoalDrafter implements GoalDrafter {
  readonly requests: GoalDraftRequest[] = [];
  next: (input: GoalDraftRequest) => GoalDraft = (input) => ({
    text: input.request,
    deadline: new Date(input.now.getTime() + 24 * 60 * 60 * 1000),
    stakeCents: 2000,
    partner: null,
    provability: 4,
    changes: [],
    questions: [],
    steps: [],
  });

  async draft(input: GoalDraftRequest) {
    this.requests.push(input);
    return this.next(input);
  }
}
