import type { Goal } from './goal';

/** A goal the agent drafted from the user's own words. A suggestion to fill the form with; the user confirms it. */
export interface GoalDraft {
  text: string;
  deadline: Date | null;
  /** only what the user said; null if they named no amount */
  stakeCents: number | null;
  partner: { name: string; email: string } | null;
  /** 1 (a photo cannot show this) to 5 (a photo settles it) */
  provability: number;
  /** how the agent sharpened the wording, and why */
  changes: string[];
  /** what the user still has to decide */
  questions: string[];
  /** what the agent looked up along the way */
  steps: string[];
}

export interface PastGoal {
  text: string;
  stakeCents: number;
  outcome: 'MET' | 'PARTLY_MET' | 'MISSED' | 'OPEN';
}

export interface GoalDraftRequest {
  /** what the user typed, in their own words */
  request: string;
  now: Date;
  /** the user's IANA time zone, for "Friday 9 pm" */
  timeZone: string;
  history: PastGoal[];
  /** The same checks a real goal must pass. Returns the problems, or an empty list. */
  check(draft: { text: string; deadline: Date | null; stakeCents: number | null }): string[];
}

/** An AI agent that turns a sentence into a goal draft. */
export interface GoalDrafter {
  draft(input: GoalDraftRequest): Promise<GoalDraft>;
}

export interface GoalRepository {
  get(goalId: string): Promise<Goal | null>;
  save(goal: Goal): Promise<void>;
  /** Newest first. */
  listByUser(userId: string): Promise<Goal[]>;
  /** ACTIVE goals whose deadline has passed and has not been announced yet. */
  listDueForSettlement(now: Date): Promise<Goal[]>;
}
