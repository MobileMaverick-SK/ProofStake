/** What the goal agent hands back to the new-goal form. Plain values only, so it can cross from server to browser. */
export interface DraftState {
  error?: string;
  draft?: {
    /** changes with every draft, so the form knows a new one arrived */
    key: number;
    text: string;
    deadlineIso: string | null;
    /** dollars and cents as typed in the stake field, for example "20.00" */
    stake: string | null;
    partner: { name: string; email: string } | null;
    provability: number;
    changes: string[];
    questions: string[];
    steps: string[];
    problems: string[];
  };
}
