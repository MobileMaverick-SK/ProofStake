'use client';

import { Icon } from './symbol';

export function PrintButton() {
  return (
    <button type="button" className="button tonal no-print" onClick={() => window.print()}>
      <Icon name="print" />
      Print or save as PDF
    </button>
  );
}
