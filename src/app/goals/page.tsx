import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/app/lib/session';
import { AppShell } from '@/app/ui/app-shell';
import { GoalRow, isDone } from '@/app/ui/goal-view';
import { Icon } from '@/app/ui/symbol';
import { getApp } from '@/composition-root';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your goals' };

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'In progress' },
  { key: 'finished', label: 'Finished' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireUser();
  const { show } = await searchParams;
  const filter: Filter = FILTERS.some((option) => option.key === show) ? (show as Filter) : 'all';

  const app = getApp();
  await app.checkDeadlines();
  const now = new Date();
  const goals = await app.goals.listGoals(user.id); // newest first
  const open = goals.filter((goal) => !isDone(goal, now));
  const finished = goals.filter((goal) => isDone(goal, now));
  const counts: Record<Filter, number> = { all: goals.length, open: open.length, finished: finished.length };
  const shown = filter === 'open' ? open : filter === 'finished' ? finished : goals;

  return (
    <AppShell user={user} active="goals" title="Your goals">
      <nav className="filter-row" aria-label="Show">
        {FILTERS.map((option) => (
          <Link
            key={option.key}
            href={option.key === 'all' ? '/goals' : `/goals?show=${option.key}`}
            className="filter-chip"
            aria-current={option.key === filter ? 'page' : undefined}
          >
            {option.label}
            <span className="count">{counts[option.key]}</span>
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <div className="empty">
          <Icon name={filter === 'finished' ? 'history' : 'flag'} className="large" />
          <h2 className="title-large">
            {filter === 'finished' ? 'No finished goals yet' : filter === 'open' ? 'Nothing in progress' : 'No goals yet'}
          </h2>
          <p>
            {filter === 'finished'
              ? 'Goals appear here once their money has settled or they have expired.'
              : 'Set a goal, a deadline and a stake to get started.'}
          </p>
          <Link href="/goals/new" className="button filled">
            <Icon name="add" />
            Set a goal
          </Link>
        </div>
      ) : (
        <ul className="goal-rows">
          {shown.map((goal) => (
            <GoalRow key={goal.id} goal={goal} />
          ))}
        </ul>
      )}

      <Link href="/goals/new" className="fab">
        <Icon name="add" />
        New goal
      </Link>
    </AppShell>
  );
}
