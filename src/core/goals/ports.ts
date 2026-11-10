import type { Goal } from './goal';

export interface GoalRepository {
  get(goalId: string): Promise<Goal | null>;
  save(goal: Goal): Promise<void>;
  /** Newest first. */
  listByUser(userId: string): Promise<Goal[]>;
  /** ACTIVE goals whose deadline has passed and has not been announced yet. */
  listDueForSettlement(now: Date): Promise<Goal[]>;
}
