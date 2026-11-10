import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PublicUser } from '@/core/accounts';
import { Icon } from './symbol';

const DESTINATIONS = [
  { key: 'home', href: '/', label: 'Home', icon: 'home' },
  { key: 'goals', href: '/goals', label: 'Goals', icon: 'flag' },
  { key: 'account', href: '/account', label: 'Account', icon: 'person' },
] as const;

export type Destination = (typeof DESTINATIONS)[number]['key'];

/**
 * The signed-in frame: a navigation bar on phones, a navigation rail on wide
 * screens, and a page header. With `backHref` the header is a detail header.
 */
export function AppShell({
  user,
  active,
  title,
  backHref,
  narrow = false,
  children,
}: {
  user: PublicUser;
  active: Destination;
  title: ReactNode;
  backHref?: string;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <nav className="nav" aria-label="Main">
        <Link href="/" className="brand-mark" aria-label="ProofStake home">
          <Icon name="verified_user" className="filled large" />
        </Link>
        <Link href="/goals/new" className="rail-fab" aria-label="New goal">
          <Icon name="add" />
        </Link>
        {DESTINATIONS.map((item) => (
          <Link key={item.key} href={item.href} className="nav-item" aria-current={item.key === active ? 'page' : undefined}>
            <span className="pill">
              <Icon name={item.icon} className={item.key === active ? 'filled' : ''} />
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
      <main className={`main${narrow ? ' narrow' : ''}`}>
        <header className="page-header">
          {backHref ? (
            <Link href={backHref} className="icon-button" aria-label="Back">
              <Icon name="arrow_back" />
            </Link>
          ) : null}
          <h1 className={`grow ${backHref ? 'title-large' : 'headline'}`}>{title}</h1>
          <Link href="/account" className="avatar" aria-label={`Account: ${user.name}`}>
            {user.name.trim().charAt(0).toUpperCase() || '?'}
          </Link>
        </header>
        {children}
      </main>
    </div>
  );
}
