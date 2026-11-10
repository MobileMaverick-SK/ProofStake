import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isReviewer } from '@/app/lib/admin';
import { reviewerLoginAction } from '@/app/review/actions';
import { PasswordField } from '@/app/ui/password-field';
import { ReviewFrame } from '@/app/ui/review-frame';
import { SubmitButton } from '@/app/ui/submit-button';
import { Icon } from '@/app/ui/symbol';
import { getApp } from '@/composition-root';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Reviewer sign-in' };

export default async function ReviewerLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isReviewer()) redirect('/review');
  const { error } = await searchParams;
  const enabled = getApp().adminGate.enabled;
  return (
    <ReviewFrame signedIn={false}>
      <main className="auth">
        <section className="card stack loose" style={{ padding: 28 }}>
          <span className="badge big warn">
            <Icon name="gavel" />
          </span>
          <div className="stack" style={{ gap: 4 }}>
            <h1 className="headline">Reviewer sign-in</h1>
            <p className="muted">
              Reviewers decide the proofs the automatic check was unsure about, and the appeals against charges. This
              is separate from a user account.
            </p>
          </div>
          {error ? (
            <div className="banner" role="alert">
              <Icon name="error" />
              <p className="body-small">{error}</p>
            </div>
          ) : null}
          {enabled ? (
            <form action={reviewerLoginAction} className="stack loose">
              <PasswordField id="password" name="password" label="Reviewer password" autoComplete="off" autoFocus />
              <SubmitButton pendingLabel="Checking…" icon="login" block>
                Open the review queue
              </SubmitButton>
            </form>
          ) : (
            <div className="banner info">
              <Icon name="key_off" />
              <p className="body-small">
                The review queue is switched off because no reviewer password is set on this server. Set
                ADMIN_PASSWORD in .env and restart.
              </p>
            </div>
          )}
        </section>
      </main>
    </ReviewFrame>
  );
}
