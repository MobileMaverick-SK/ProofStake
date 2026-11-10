import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signupAction } from '@/app/actions';
import { currentUser } from '@/app/lib/session';
import { AuthForm } from '@/app/ui/auth-form';
import { PublicFrame } from '@/app/ui/public-frame';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Create your account' };

export default async function SignupPage() {
  if (await currentUser()) redirect('/');
  return (
    <PublicFrame>
      <main className="auth">
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="headline">Create your account</h1>
          <p className="muted">It takes a name, an email and a password. No card needed.</p>
        </div>
        <AuthForm mode="signup" action={signupAction} />
        <p className="muted">
          Already have an account?{' '}
          <Link href="/login" className="button text" style={{ minHeight: 40 }}>
            Sign in
          </Link>
        </p>
      </main>
    </PublicFrame>
  );
}
