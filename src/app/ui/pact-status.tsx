import { formatMoney } from '@/app/lib/format';
import type { Pact } from '@/core/pacts';
import { LocalTime } from './time';

const PROVIDER_STATUS = {
  PROCESSING: 'PayPal is processing it.',
  PAID: 'PayPal confirms it was paid.',
  UNCLAIMED: 'There is no PayPal account for that email yet. PayPal holds it until one is opened.',
  FAILED: 'PayPal could not deliver it, so it stays in the charity pool.',
} as const;

/** One sentence on where a lost stake is on its way to the pact partner, worded for whoever is reading. */
export function PayoutLine({ pact, viewer }: { pact: Pact; viewer: 'owner' | 'partner' }) {
  const payout = pact.payout;
  if (!payout) return null;
  const amount = formatMoney(payout.amount);
  const to = viewer === 'owner' ? pact.partnerName : 'you';
  const them = viewer === 'owner' ? 'you' : pact.ownerName;
  switch (payout.status) {
    case 'SCHEDULED':
      return (
        <p>
          {amount} will be sent to {to} after <LocalTime iso={payout.dueAt.toISOString()} />, unless {them}{' '}
          {viewer === 'owner' ? 'appeal' : 'appeals'} first.
          {payout.lastError ? ` The last attempt failed: ${payout.lastError.message} It is tried again every 30 seconds.` : ''}
        </p>
      );
    case 'ON_HOLD':
      return (
        <p>
          {amount} is waiting: {viewer === 'owner' ? 'your appeal is' : `${pact.ownerName} appealed, and that is`} with a
          reviewer. Nothing is sent until they decide.
        </p>
      );
    case 'SENT':
      return (
        <p>
          {amount} was sent to {viewer === 'owner' ? `${pact.partnerName} (${pact.payoutEmail})` : pact.payoutEmail}.{' '}
          {PROVIDER_STATUS[payout.providerStatus ?? 'PROCESSING']}
        </p>
      );
    case 'CANCELLED':
      return <p>Nothing was sent to {to}: the appeal was upheld and the charge refunded.</p>;
  }
}
