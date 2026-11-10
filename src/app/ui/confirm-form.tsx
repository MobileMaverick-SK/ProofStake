'use client';

import { useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { SubmitButton } from './submit-button';
import { Icon } from './symbol';

/** The dialog's buttons. A separate component so it can watch the form it sits in. */
function DialogActions({
  onCancel,
  confirmLabel,
  pendingLabel,
  progressNote,
}: {
  onCancel: () => void;
  confirmLabel: string;
  pendingLabel: string;
  progressNote: string;
}) {
  const { pending } = useFormStatus();
  return (
    <>
      {pending ? (
        <div className="stack" role="status" style={{ gap: 8 }}>
          <div className="progress" />
          <p className="body-small muted">{progressNote}</p>
        </div>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="button text" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <SubmitButton pendingLabel={pendingLabel}>{confirmLabel}</SubmitButton>
      </div>
    </>
  );
}

/**
 * A form whose submit goes through a confirmation dialog first. For actions
 * that move money or cannot be undone. Extra fields (`children`) are submitted
 * with it.
 */
export function ConfirmForm({
  action,
  triggerLabel,
  triggerIcon,
  variant = 'filled',
  title,
  body,
  confirmLabel,
  pendingLabel,
  progressNote = 'Working on it. This can take a few seconds.',
  children,
  className,
}: {
  action: (form: FormData) => void | Promise<void>;
  triggerLabel: string;
  triggerIcon?: string;
  variant?: 'filled' | 'tonal' | 'outlined' | 'text';
  title: string;
  body: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  /** Shown with a progress bar while the confirmed action runs. */
  progressNote?: string;
  children?: ReactNode;
  className?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  function open() {
    // Let the browser show any "this field is required" message before asking for confirmation.
    if (form.current && !form.current.reportValidity()) return;
    dialog.current?.showModal();
  }

  return (
    <form action={action} ref={form} className={className}>
      {children}
      <div>
        <button type="button" className={`button ${variant}`} onClick={open}>
          {triggerIcon ? <Icon name={triggerIcon} /> : null}
          {triggerLabel}
        </button>
      </div>
      <dialog ref={dialog} className="dialog" aria-labelledby="confirm-title">
        <h2 id="confirm-title" className="title-large">
          {title}
        </h2>
        <div className="body-small muted">{body}</div>
        <DialogActions
          onCancel={() => dialog.current?.close()}
          confirmLabel={confirmLabel}
          pendingLabel={pendingLabel}
          progressNote={progressNote}
        />
      </dialog>
    </form>
  );
}
