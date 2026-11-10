'use client';

import type { FormState } from '@/app/lib/form-state';
import { PasswordField } from './password-field';
import { SubmitButton } from './submit-button';
import { useKeptForm } from './use-kept-form';
import { Icon } from './symbol';

/** Sign-in or sign-up. On an error the message appears in place and what was typed (except the password) stays. */
export function AuthForm({
  mode,
  action,
}: {
  mode: 'login' | 'signup';
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const { state, pending, onSubmit } = useKeptForm(action);
  const signup = mode === 'signup';
  return (
    <form onSubmit={onSubmit} className="stack loose">
      {state.error ? (
        <div className="banner" role="alert">
          <Icon name="error" />
          <p className="body-small">{state.error}</p>
        </div>
      ) : null}
      {signup ? (
        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            maxLength={80}
            autoFocus
            defaultValue={state.values?.name}
          />
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus={!signup}
          defaultValue={state.values?.email}
        />
      </div>
      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete={signup ? 'new-password' : 'current-password'}
        minLength={signup ? 8 : undefined}
        hint={signup ? 'At least 8 characters.' : undefined}
      />
      <SubmitButton pending={pending} pendingLabel={signup ? 'Creating your account…' : 'Signing in…'} block>
        {signup ? 'Create account' : 'Sign in'}
      </SubmitButton>
    </form>
  );
}
