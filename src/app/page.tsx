import Link from 'next/link';
import { getApp } from '@/composition-root';
import type { Goal, GoalState } from '@/core/goals';
import { usd } from '@/core/shared';
import { formatMoney } from './lib/format';
import { currentUser } from './lib/session';
import { AppShell } from './ui/app-shell';
import { RefreshAt } from './ui/auto-refresh';
import { Carousel } from './ui/carousel';
import { FINISHED, StateChip, isDone, viewOf } from './ui/goal-view';
import { Landing } from './ui/landing';
import { Icon } from './ui/symbol';
import { Countdown, LocalTime, TimeRing } from './ui/time';

export const dynamic = 'force-dynamic';

/** Money totals shown on the dashboard. Display arithmetic only; settlement amounts are decided in the core. */
function totals(goals: Goal[]) {
  let onHold = 0;
  let kept = 0;
  let charity = 0;
  for (const goal of goals) {
    const captured = goal.capture?.amount.cents ?? 0;
    if (goal.state === 'ACTIVE' || goal.state === 'PROOF_SUBMITTED' || goal.state === 'IN_REVIEW') onHold += goal.stake.cents;
    else if (goal.state === 'REFUNDED') kept += goal.stake.cents;
    else if (FINISHED.has(goal.state)) {
      kept += goal.stake.cents - captured;
      charity += captured;
    }
  }
  return { onHold: usd(onHold), kept: usd(kept), charity: usd(charity) };
}

/** Which unfinished goals come first: a running deadline, then anything waiting on the user, then waiting on us. */
const URGENCY: Partial<Record<GoalState, number>> = {
  ACTIVE: 0,
  AWAITING_STAKE: 1,
  RULES_PROPOSED: 1,
  DRAFT: 1,
  PROOF_SUBMITTED: 2,
  IN_REVIEW: 3,
};
const byUrgency = (a: Goal, b: Goal) =>
  (URGENCY[a.state] ?? 9) - (URGENCY[b.state] ?? 9) || a.deadline.getTime() - b.deadline.getTime();

const WHAT_NEXT: Partial<Record<GoalState, string>> = {
  ACTIVE: 'Finish the work, then upload a photo of it with your one-time code.',
  AWAITING_STAKE: 'Place the hold to start the clock on this goal.',
  RULES_PROPOSED: 'Read the proof rules and accept them.',
  DRAFT: 'The proof rules still need to be written.',
  PROOF_SUBMITTED: 'Your photo is being checked.',
  IN_REVIEW: 'A reviewer is deciding. Nothing is charged meanwhile.',
};

function GoalSlide({ goal }: { goal: Goal }) {
  const view = viewOf(goal, new Date());
  const deadline = goal.deadline.toISOString();
  const running = goal.state === 'ACTIVE';
  const tone = running ? ' tertiary' : goal.state === 'IN_REVIEW' || goal.state === 'PROOF_SUBMITTED' ? ' neutral' : '';
  return (
    <article className={`hero${tone}`}>
      <div className="row" style={{ gap: 20, alignItems: 'flex-start' }}>
        <div className="grow stack">
          <div className="row spread wrap">
            <StateChip goal={goal} onContainer />
            <span className="label numeric">
              {formatMoney(goal.stake)} {running ? 'on hold' : 'stake'}
            </span>
          </div>
          <h3 className="title-large">{goal.text}</h3>
          {running ? (
            <p className="timer">
              <Countdown deadline={deadline} />
            </p>
          ) : (
            <p className="row tight">
              <Icon name="event" className="small" />
              Due <LocalTime iso={deadline} />
            </p>
          )}
          <p className="body-small">{WHAT_NEXT[goal.state]}</p>
        </div>
        {running ? (
          <TimeRing start={goal.createdAt.toISOString()} deadline={deadline}>
            <Icon name="timer" className="large" />
          </TimeRing>
        ) : null}
      </div>
      <div style={{ marginTop: 20 }}>
        <Link href={`/goals/${goal.id}`} className="button on-container">
          {view.next}
        </Link>
      </div>
    </article>
  );
}

export default async function HomePage() {
  const user = await currentUser();
  if (!user) return <Landing />;

  const app = getApp();
  await app.checkDeadlines();
  const goals = await app.goals.listGoals(user.id);
  const now = new Date();
  const open = goals.filter((goal) => !isDone(goal, now)).sort(byUrgency);
  const finishedCount = goals.length - open.length;
  const nextDeadline = open.find((goal) => goal.state === 'ACTIVE');
  const money = totals(goals);
  const firstName = user.name.trim().split(/\s+/)[0];

  return (
    <AppShell user={user} active="home" title={`Hi, ${firstName}`}>
      {nextDeadline ? <RefreshAt iso={nextDeadline.deadline.toISOString()} /> : null}

      {open.length > 0 ? (
        <section className="stack" aria-labelledby="open-heading">
          <div className="section-title">
            <h2 id="open-heading" className="title">
              {open.length === 1 ? 'Your goal in progress' : `Your ${open.length} goals in progress`}
            </h2>
            <Link href="/goals" className="button text">
              See all
              <Icon name="arrow_forward" />
            </Link>
          </div>
          <Carousel label="Goals in progress">
            {open.map((goal) => (
              <GoalSlide key={goal.id} goal={goal} />
            ))}
          </Carousel>
        </section>
      ) : (
        <section className="hero neutral stack">
          <h2 className="headline">{goals.length === 0 ? 'What will you finish first?' : 'Nothing in progress'}</h2>
          <p style={{ maxWidth: '44ch' }}>
            Set a goal, a deadline and a stake. Prove you did it with a photo and you pay nothing.
          </p>
          <div className="row wrap">
            <Link href="/goals/new" className="button filled">
              <Icon name="add" />
              Set a goal
            </Link>
            {finishedCount > 0 ? (
              <Link href="/goals?show=finished" className="button outlined">
                See finished goals
              </Link>
            ) : null}
          </div>
        </section>
      )}

      <section className="stats" aria-label="Your money">
        <div className="stat">
          <span className="badge warn">
            <Icon name="lock" />
          </span>
          <div>
            <p className="value">{formatMoney(money.onHold)}</p>
            <p className="label-small muted">On hold now</p>
          </div>
        </div>
        <div className="stat">
          <span className="badge good">
            <Icon name="savings" />
          </span>
          <div>
            <p className="value">{formatMoney(money.kept)}</p>
            <p className="label-small muted">Kept</p>
          </div>
        </div>
        <div className="stat">
          <span className="badge">
            <Icon name="volunteer_activism" />
          </span>
          <div>
            <p className="value">{formatMoney(money.charity)}</p>
            <p className="label-small muted">To charity</p>
          </div>
        </div>
      </section>

      {goals.length > 0 ? (
        <Link href="/goals" className="goal-card">
          <span className="badge big">
            <Icon name="format_list_bulleted" />
          </span>
          <span className="grow stack" style={{ gap: 2 }}>
            <span className="title">All your goals</span>
            <span className="body-small muted">
              {open.length} in progress, {finishedCount} finished
            </span>
          </span>
          <Icon name="chevron_right" className="muted" />
        </Link>
      ) : null}

      <Link href="/goals/new" className="fab">
        <Icon name="add" />
        New goal
      </Link>
    </AppShell>
  );
}
