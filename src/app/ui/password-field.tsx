'use client';

import { useState } from 'react';
import { Icon } from './symbol';

/** A password input with a show / hide button, so a typo can be seen before submitting. */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  minLength,
  hint,
  autoFocus,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  minLength?: number;
  hint?: string;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="with-trailing">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          minLength={minLength}
          autoFocus={autoFocus}
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <button
          type="button"
          className="icon-button trailing"
          onClick={() => setVisible((shown) => !shown)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          <Icon name={visible ? 'visibility_off' : 'visibility'} />
        </button>
      </div>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
