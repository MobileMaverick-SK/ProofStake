import Link from 'next/link';
import type { ReactNode } from 'react';
import { reviewerLogoutAction } from '@/app/review/actions';
import { SubmitButton } from './submit-button';
import { Icon } from './symbol';

/** The frame for the reviewer's own screens: clearly a different area from a user's account. */
export function ReviewFrame({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  return (
    <div className="public">
      <header className="public-bar">
        <span className="row">
          <Link href={signedIn ? '/review' : '/'} className="brand">
            <Icon name="verified_user" className="filled" />
            ProofStake
          </Link>
          <span className="chip warn">
            <Icon name="gavel" className="small" />
            Reviewer
          </span>
        </span>
        {signedIn ? (
          <form action={reviewerLogoutAction}>
            <SubmitButton pendingLabel="Signing out…" icon="logout" variant="text">
              Sign out
            </SubmitButton>
          </form>
        ) : (
          <Link href="/" className="button text">
            <Icon name="arrow_back" />
            Back to ProofStake
          </Link>
        )}
      </header>
      {children}
      <footer className="public-footer no-print">
        <span>PayPal sandbox demo. No real money moves.</span>
      </footer>
    </div>
  );
}
