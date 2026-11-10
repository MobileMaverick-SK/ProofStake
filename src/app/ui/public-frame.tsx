import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from './symbol';

/** The frame for signed-out pages: brand on the left, one action on the right. */
export function PublicFrame({
  action,
  reviewerLink = true,
  children,
}: {
  action?: ReactNode;
  /** Show the way in to the review queue. Off on the reviewer's own screens. */
  reviewerLink?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="public">
      <header className="public-bar">
        <Link href="/" className="brand">
          <Icon name="verified_user" className="filled" />
          ProofStake
        </Link>
        {action}
      </header>
      {children}
      <footer className="public-footer no-print">
        <span>PayPal sandbox demo. No real money moves.</span>
        {reviewerLink ? (
          <Link href="/review" className="button text">
            <Icon name="gavel" />
            Reviewer sign-in
          </Link>
        ) : null}
      </footer>
    </div>
  );
}
