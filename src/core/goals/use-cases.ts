import { newId, notFound, usd, type Clock, type EventBus } from '../shared';
import { validateNewGoal, type Goal } from './goal';
import type { GoalRepository } from './ports';
import { transition, type GoalState } from './state-machine';

export interface GoalsDeps {
  goals: GoalRepository;
  bus: EventBus;
  clock: Clock;
}

export function createGoalsUseCases({ goals, bus, clock }: GoalsDeps) {
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
