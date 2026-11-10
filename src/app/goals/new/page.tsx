import type { Metadata } from 'next';
import { createGoalAction, draftGoalAction } from '@/app/actions';
import { requireUser } from '@/app/lib/session';
import { AppShell } from '@/app/ui/app-shell';
import { NewGoalForm } from '@/app/ui/new-goal-form';
import { getApp } from '@/composition-root';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New goal' };

export default async function NewGoalPage() {
  const user = await requireUser();
  const app = getApp();
  const saved = await app.settlement.getSavedMethod(user.id);
  return (
    <AppShell user={user} active="goals" title="New goal" backHref="/goals" narrow>
      <NewGoalForm
        action={createGoalAction}
        draftAction={app.aiConfigured ? draftGoalAction : undefined}
        savedAccount={saved ? (saved.label ?? 'your saved PayPal account') : null}
      />
    </AppShell>
  );
}
