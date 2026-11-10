'use client';

import { startTransition, useActionState, type FormEvent } from 'react';
import type { FormState } from '@/app/lib/form-state';

/**
 * Runs a server action for a form without letting React clear the form
 * afterwards. A failed submit then leaves everything the user typed and chose
 * exactly as it was, next to the error message.
 */
export function useKeptForm(action: (state: FormState, form: FormData) => Promise<FormState>) {
  const [state, submit, pending] = useActionState(action, {});
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => submit(data));
  }
  return { state, pending, onSubmit };
}
