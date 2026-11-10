import type { Metadata } from 'next';
import { forgetSavedMethodAction, logoutAction, startSavingMethodAction } from '@/app/actions';
import { requireUser } from '@/app/lib/session';
import { AppShell } from '@/app/ui/app-shell';
import { ConfirmForm } from '@/app/ui/confirm-form';
import { getApp } from '@/composition-root';
import { SubmitButton } from '@/app/ui/submit-button';
import { Icon } from '@/app/ui/symbol';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Account' };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireUser();
  const { error, notice } = await searchParams;
  const paypalReady = getApp().paypalConfigured;
  const savedMethod = await getApp().settlement.getSavedMethod(user.id);
  return (
    <AppShell user={user} active="account" title="Account" narrow>
      <section className="card row">
        <span className="avatar big" aria-hidden="true">
          {user.name.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div className="grow stack" style={{ gap: 2 }}>
          <h2 className="title-large">{user.name}</h2>
          <p className="muted" style={{ overflowWrap: 'anywhere' }}>
            {user.email}
          </p>
        </div>
      </section>

      {error ? (
        <div className="banner" role="alert">
          <Icon name="error" />
          <p className="body-small">{error}</p>
        </div>
      ) : null}
      {notice ? (
        <div className="banner info" role="status">
          <Icon name="check_circle" />
          <p className="body-small">{notice}</p>
        </div>
      ) : null}

      <section className="card stack">
        <h2 className="title">Saved PayPal account</h2>
        {savedMethod ? (
          <>
            <div className="row">
              <span className="badge good">
                <Icon name="account_balance_wallet" />
              </span>
              <div className="grow stack" style={{ gap: 2 }}>
                <p style={{ overflowWrap: 'anywhere' }}>{savedMethod.label ?? 'PayPal account'}</p>
                <p className="body-small muted">Holds for new goals take one tap, with no PayPal sign-in.</p>
              </div>
            </div>
            <ConfirmForm
              action={forgetSavedMethodAction}
              triggerLabel="Remove"
              triggerIcon="delete"
              variant="outlined"
              title="Remove your saved PayPal account?"
              body="Your next hold will ask you to sign in to PayPal again. Holds already placed are not affected."
              confirmLabel="Remove"
              pendingLabel="Removing…"
            />
          </>
        ) : (
          <>
            <p className="body-small muted">
              None saved. Save one and holds for new goals take one tap, with no PayPal sign-in each time. You approve
              it once on PayPal's own page, and nothing is held or charged by saving.
            </p>
            {paypalReady ? (
              <form action={startSavingMethodAction}>
                <SubmitButton pendingLabel="Opening PayPal…" icon="add_card" variant="tonal">
                  Save a PayPal account
                </SubmitButton>
              </form>
            ) : (
              <p className="body-small muted">PayPal is not set up on this server.</p>
            )}
          </>
        )}
      </section>

      <section className="card stack">
        <h2 className="title">About your money</h2>
        <ul className="list">
          <li>
            <Icon name="science" />
            <p className="grow">This is a PayPal sandbox demo. Holds and charges use test accounts, never real money.</p>
          </li>
          <li>
            <Icon name="lock" />
            <p className="grow">A stake is held, not charged. It is only charged if a goal is missed or partly met.</p>
          </li>
          <li>
            <Icon name="volunteer_activism" />
            <p className="grow">Charged stakes go to the charity pool, never to other users.</p>
          </li>
        </ul>
      </section>

      <form action={logoutAction}>
        <SubmitButton pendingLabel="Signing out…" icon="logout" variant="tonal">
          Sign out
        </SubmitButton>
      </form>
    </AppShell>
  );
}
