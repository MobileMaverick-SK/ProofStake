import Link from 'next/link';
import { formatMoney } from '@/app/lib/format';
import { isExpiredWithoutHold, type Goal, type GoalState } from '@/core/goals';
import { Icon } from './symbol';
import { Countdown, LocalTime } from './time';

export type Tone = '' | 'good' | 'warn' | 'bad';

export const STATE_VIEW: Record<GoalState, { label: string; icon: string; tone: Tone; next: string }> = {
  DRAFT: { label: 'Writing rules', icon: 'edit_note', tone: '', next: 'Finish setting up' },
  RULES_PROPOSED: { label: 'Review the rules', icon: 'checklist', tone: 'warn', next: 'Review the proof rules' },
  AWAITING_STAKE: { label: 'Place the hold', icon: 'lock', tone: 'warn', next: 'Place the hold with PayPal' },
  ACTIVE: { label: 'In progress', icon: 'timer', tone: 'good', next: 'Upload proof' },
  PROOF_SUBMITTED: { label: 'Checking proof', icon: 'hourglass_top', tone: '', next: 'See the check' },
  IN_REVIEW: { label: 'In review', icon: 'manage_search', tone: 'warn', next: 'See the review' },
  SETTLED_RELEASED: { label: 'Goal met', icon: 'check_circle', tone: 'good', next: 'See the receipt' },
  SETTLED_PARTIAL: { label: 'Partly met', icon: 'incomplete_circle', tone: 'warn', next: 'See the receipt' },
  SETTLED_FORFEITED: { label: 'Missed', icon: 'cancel', tone: 'bad', next: 'See the receipt' },
  REFUNDED: { label: 'Refunded', icon: 'undo', tone: '', next: 'See the receipt' },
};

export const FINISHED: ReadonlySet<GoalState> = new Set(['SETTLED_RELEASED', 'SETTLED_PARTIAL', 'SETTLED_FORFEITED', 'REFUNDED']);

const EXPIRED = { label: 'Expired', icon: 'timer_off', tone: '' as Tone, next: 'See what happened' };

/** How a goal should be presented right now. A goal that ran out of time before a hold shows as expired. */
export function viewOf(goal: Goal, now: Date) {
  return isExpiredWithoutHold(goal, now) ? EXPIRED : STATE_VIEW[goal.state];
}

/** Nothing more can happen to this goal: its money settled, or it expired before any was held. */
export function isDone(goal: Goal, now: Date): boolean {
  return FINISHED.has(goal.state) || isExpiredWithoutHold(goal, now);
}

export function StateChip({ goal, onContainer = false }: { goal: Goal; onContainer?: boolean }) {
  const { label, icon, tone } = viewOf(goal, new Date());
  return (
    <span className={`chip ${onContainer ? 'on-container' : tone}`.trim()}>
      <Icon name={icon} className="small" />
      {label}
    </span>
  );
}

/** What happened to the money for a finished goal, in a few words. */
function moneyLine(goal: Goal): string {
  if (!FINISHED.has(goal.state)) return 'Expired before a hold was placed';
  const captured = goal.capture?.amount.cents ?? 0;
  if (goal.state === 'REFUNDED') return `${formatMoney(goal.stake)} refunded`;
  if (captured === 0) return `Kept ${formatMoney(goal.stake)}`;
  return `${formatMoney({ cents: captured, currency: 'USD' })} to charity`;
}

export function GoalCard({ goal }: { goal: Goal }) {
  const now = new Date();
  const view = viewOf(goal, now);
  const deadline = goal.deadline.toISOString();
  const finished = isDone(goal, now);
  return (
    <li>
      <Link href={`/goals/${goal.id}`} className="goal-card">
        <span className={`badge big ${view.tone}`.trim()}>
          <Icon name={view.icon} />
        </span>
        <span className="grow stack" style={{ gap: 2 }}>
          <span className="title text">{goal.text}</span>
          <span className="body-small muted">
            {finished ? (
              moneyLine(goal)
            ) : goal.state === 'ACTIVE' ? (
              <>
                <Countdown deadline={deadline} /> left
              </>
            ) : (
              <>
                {view.label}, due <LocalTime iso={deadline} />
              </>
            )}
          </span>
        </span>
        <span className="label numeric">{formatMoney(goal.stake)}</span>
      </Link>
    </li>
  );
}

/** One line of the all-goals list: what it is, where it stands, and the money. */
export function GoalRow({ goal }: { goal: Goal }) {
  const now = new Date();
  const view = viewOf(goal, now);
  const deadline = goal.deadline.toISOString();
  const finished = isDone(goal, now);
  const captured = goal.capture?.amount.cents ?? 0;
  const settled = FINISHED.has(goal.state);
  return (
    <li>
      <Link href={`/goals/${goal.id}`} className="goal-row">
        <span className={`badge big ${view.tone}`.trim()}>
          <Icon name={view.icon} />
        </span>
        <span>
          <span className="title text">{goal.text}</span>
          <span className="meta">
            <StateChip goal={goal} />
            <span className="body-small muted">
              {goal.state === 'ACTIVE' ? (
                <>
                  <Countdown deadline={deadline} /> left
                </>
              ) : (
                <>
                  {finished ? 'Was due' : 'Due'} <LocalTime iso={deadline} />
                </>
              )}
            </span>
          </span>
        </span>
        <span className="end">
          <span>
            <span className="amount">{formatMoney(goal.stake)}</span>
            <br />
            <span className="body-small muted">
              {!settled
                ? finished
                  ? 'never held'
                  : 'stake'
                : goal.state === 'REFUNDED'
                  ? 'refunded'
                  : captured === 0
                    ? 'kept'
                    : `${formatMoney({ cents: captured, currency: 'USD' })} charged`}
            </span>
          </span>
          <Icon name="chevron_right" className="muted" />
        </span>
      </Link>
    </li>
  );
}
