import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { loginAction } from '@/app/actions';
import { currentUser } from '@/app/lib/session';
import { AuthForm } from '@/app/ui/auth-form';
import { PublicFrame } from '@/app/ui/public-frame';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  return (
    <PublicFrame>
      <main className="auth">
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="headline">Sign in</h1>
          <p className="muted">Pick up your goals where you left them.</p>
        </div>
        <AuthForm mode="login" action={loginAction} />
        <p className="muted">
          New here?{' '}
          <Link href="/signup" className="button text" style={{ minHeight: 40 }}>
            Create an account
          </Link>
        </p>
      </main>
    </PublicFrame>
  );
}
