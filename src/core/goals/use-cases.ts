import { DomainError, newId, notFound, usd, type Clock, type EventBus } from '../shared';
import { MIN_STAKE_CENTS, validateNewGoal, type Goal } from './goal';
import type { GoalDraft, GoalDrafter, GoalRepository, PastGoal } from './ports';

const OUTCOME: Partial<Record<GoalState, PastGoal['outcome']>> = {
  SETTLED_RELEASED: 'MET',
  SETTLED_PARTIAL: 'PARTLY_MET',
  SETTLED_FORFEITED: 'MISSED',
};
import { transition, type GoalState } from './state-machine';

export interface GoalsDeps {
  goals: GoalRepository;
  /** absent when no AI service is configured */
  drafter?: GoalDrafter;
  bus: EventBus;
  clock: Clock;
}

export function createGoalsUseCases({ goals, drafter, bus, clock }: GoalsDeps) {
  async function load(goalId: string): Promise<Goal> {
    const goal = await goals.get(goalId);
    if (!goal) throw notFound('Goal', goalId);
    return goal;
  }

  async function move(goalId: string, to: GoalState, patch: Partial<Goal> = {}): Promise<void> {
    const goal = await load(goalId);
    await goals.save({ ...goal, ...patch, state: transition(goal.state, to) });
  }

  return {
    async createGoal(input: { userId: string; text: string; deadline: Date; stakeCents: number }): Promise<Goal> {
      const now = clock.now();
      const valid = validateNewGoal(input, now);
      if (!valid.ok) throw valid.error;

      const goal: Goal = {
        id: newId('goal'),
        userId: input.userId,
        text: valid.value.text,
        deadline: valid.value.deadline,
        stake: usd(valid.value.stakeCents),
        state: 'DRAFT',
        createdAt: now,
        deadlineAnnounced: false,
      };
      await goals.save(goal);
      await bus.publish({
        type: 'GoalCreated',
        goalId: goal.id,
        userId: goal.userId,
        goalText: goal.text,
        deadline: goal.deadline,
        stake: goal.stake,
      });
      return load(goal.id);
    },

    /**
     * Asks the goal agent to turn the user's own words into a draft. Nothing is
     * saved: the draft fills the form, and creating the goal validates it again.
     */
    async draftGoal(userId: string, request: string, timeZone: string): Promise<{ draft: GoalDraft; problems: string[] }> {
      const text = request.trim();
      if (text.length < 5 || text.length > 600) {
        throw new DomainError('VALIDATION', 'Describe what you want to do in 5 to 600 characters');
      }
      if (!drafter) throw new DomainError('CONFLICT', 'The goal agent needs an AI key (AI_API_KEY) on the server');
      const now = clock.now();
      const check = (draft: { text: string; deadline: Date | null; stakeCents: number | null }): string[] => {
        const problems: string[] = [];
        if (!draft.deadline) problems.push('No deadline was given');
        if (draft.stakeCents === null) problems.push('No stake was given');
        const valid = validateNewGoal(
          { text: draft.text, deadline: draft.deadline ?? new Date(now.getTime() + 60_000), stakeCents: draft.stakeCents ?? MIN_STAKE_CENTS },
          now,
        );
        if (!valid.ok) problems.push(...valid.error.message.split('; '));
        return problems;
      };
      const history = (await goals.listByUser(userId)).slice(0, 8).map((goal) => ({
        text: goal.text,
        stakeCents: goal.stake.cents,
        outcome: OUTCOME[goal.state] ?? 'OPEN',
      }));
      const draft = await drafter.draft({ request: text, now, timeZone, history, check });
      const tidy: GoalDraft = {
        ...draft,
        text: draft.text.trim().slice(0, 500),
        provability: Math.min(5, Math.max(1, Math.round(draft.provability))),
      };
      return { draft: tidy, problems: check(tidy) };
    },

    getGoal: load,

    /** The goal, but only for its owner. Anyone else gets the same NOT_FOUND as for a goal that does not exist. */
    async getOwnedGoal(userId: string, goalId: string): Promise<Goal> {
      const goal = await load(goalId);
      if (goal.userId !== userId) throw notFound('Goal', goalId);
      return goal;
    },

    listGoals: (userId: string) => goals.listByUser(userId),

    /** Called by the scheduler. Announces each passed deadline exactly once. */
    async tickDeadlines(): Promise<number> {
      const due = await goals.listDueForSettlement(clock.now());
      for (const goal of due) {
        await goals.save({ ...goal, deadlineAnnounced: true });
        await bus.publish({ type: 'DeadlinePassed', goalId: goal.id });
      }
      return due.length;
    },

    move,
  };
}
