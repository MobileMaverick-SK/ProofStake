'use client';

import { useState } from 'react';
import { Icon } from './symbol';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the value is on screen to copy by hand.
    }
  }
  return (
    <button type="button" className="button text" onClick={copy} aria-live="polite">
      <Icon name={copied ? 'check' : 'content_copy'} />
      {copied ? 'Copied' : label}
    </button>
  );
}
