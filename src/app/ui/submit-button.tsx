'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Icon } from './symbol';

/**
 * A form's submit button. While the form is working it keeps its colour, shows
 * a spinner and what is happening, and cannot be pressed twice. With
 * `progressNote` a progress bar and a sentence appear underneath, for steps
 * that take a few seconds (the AI, PayPal).
 */
export function SubmitButton({
  children,
  pendingLabel,
  icon,
  variant = 'filled',
  block = false,
  pending: pendingOverride,
  progressNote,
}: {
  children: ReactNode;
  pendingLabel: string;
  icon?: string;
  variant?: 'filled' | 'tonal' | 'outlined' | 'text';
  block?: boolean;
  /** For forms submitted by hand (see useKeptForm), which useFormStatus cannot observe. */
  pending?: boolean;
  progressNote?: string;
}) {
  const status = useFormStatus();
  const pending = pendingOverride ?? status.pending;
  const button = (
    <button
      type="submit"
      className={`button ${variant}${block ? ' block' : ''}${pending ? ' busy' : ''}`}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {pending ? pendingLabel : children}
    </button>
  );
  if (!progressNote) return button;
  return (
    <div className="stack">
      {button}
      {pending ? (
        <div className="stack" role="status" style={{ gap: 8 }}>
          <div className="progress" />
          <p className="body-small muted">{progressNote}</p>
        </div>
      ) : null}
    </div>
  );
}
