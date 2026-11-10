import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/app/lib/format';
import { requireUser } from '@/app/lib/session';
import { AppShell } from '@/app/ui/app-shell';
import { PrintButton } from '@/app/ui/print-button';
import { Icon } from '@/app/ui/symbol';
import { LocalTime } from '@/app/ui/time';
import { getApp } from '@/composition-root';
import { MAX_PROOF_ATTEMPTS } from '@/core/proof-intake';
import { isDomainError, usd } from '@/core/shared';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Receipt' };

async function orNull<T>(load: Promise<T>): Promise<T | null> {
  try {
    return await load;
  } catch (error) {
    if (isDomainError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

const OUTCOME: Record<string, { title: string; icon: string }> = {
  SETTLED_RELEASED: { title: 'Goal met', icon: 'check_circle' },
  SETTLED_PARTIAL: { title: 'Goal partly met', icon: 'incomplete_circle' },
  SETTLED_FORFEITED: { title: 'Goal missed', icon: 'cancel' },
  REFUNDED: { title: 'Refunded after appeal', icon: 'undo' },
};

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const app = getApp();
  const goal = await orNull(app.goals.getOwnedGoal(user.id, id));
  if (!goal) notFound();
  const [stake, slot, verdict] = await Promise.all([
    orNull(app.settlement.getStake(id)),
    orNull(app.proofIntake.getProofSlot(id)),
    orNull(app.verification.getVerdict(id)),
  ]);
  const outcome = OUTCOME[goal.state];
  const backHref = `/goals/${goal.id}`;

  if (!stake || !outcome || (stake.status !== 'RELEASED' && stake.status !== 'CAPTURED')) {
    return (
      <AppShell user={user} active="goals" title="Receipt" backHref={backHref} narrow>
        <div className="empty">
          <Icon name="receipt_long" className="large" />
          <h2 className="title-large">No receipt yet</h2>
          <p>A receipt appears once the money for this goal has been released or charged.</p>
          <Link href={backHref} className="button tonal">
            Back to the goal
          </Link>
        </div>
      </AppShell>
    );
  }

  const captured = stake.capturedAmount ?? usd(0);
  const released = usd(stake.amount.cents - captured.cents);
  const refunded = goal.refund?.amount ?? usd(0);
  const paid = usd(captured.cents - refunded.cents);
  const iso = (date: Date | string) => new Date(date).toISOString();

  return (
    <AppShell user={user} active="goals" title="Receipt" backHref={backHref} narrow>
      <section className="card stack">
        <div className="row">
          <span className="badge big">
            <Icon name={outcome.icon} className="filled" />
          </span>
          <div className="grow stack" style={{ gap: 2 }}>
            <h2 className="title-large">{outcome.title}</h2>
            <p className="body-small muted">{goal.text}</p>
          </div>
        </div>
        <dl className="kv">
          <dt>Stake held by PayPal</dt>
          <dd>{formatMoney(stake.amount)}</dd>
          <dt>Released back to you</dt>
          <dd>{formatMoney(released)}</dd>
          <dt>Charged, to the charity pool</dt>
          <dd>{formatMoney(captured)}</dd>
          {goal.refund ? (
            <>
              <dt>Refunded to you</dt>
              <dd>{formatMoney(refunded)}</dd>
            </>
          ) : null}
        </dl>
        <div className="total-row">
          <span className="title">You paid</span>
          <span className="amount">{formatMoney(paid)}</span>
        </div>
      </section>

      <section className="card outlined stack" aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="title">
          What happened
        </h2>
        <ol className="timeline">
          <li>
            <Icon name="flag" />
            <div>
              <p>Goal set, due <LocalTime iso={iso(goal.deadline)} /></p>
              <p className="body-small muted"><LocalTime iso={iso(goal.createdAt)} /></p>
            </div>
          </li>
          {stake.heldAt ? (
            <li>
              <Icon name="lock" />
              <div>
                <p>PayPal placed a {formatMoney(stake.amount)} hold</p>
                <p className="body-small muted"><LocalTime iso={iso(stake.heldAt)} /></p>
              </div>
            </li>
          ) : null}
          {slot?.proof ? (
            <li>
              <Icon name="photo_camera" />
              <div>
                <p>
                  Proof uploaded ({slot.attempts ?? 1} of {MAX_PROOF_ATTEMPTS} uploads used)
                  {verdict ? `, checked with ${Math.round(verdict.confidence * 100)}% confidence` : ''}
                </p>
                <p className="body-small muted"><LocalTime iso={iso(slot.proof.submittedAt)} /></p>
              </div>
            </li>
          ) : (
            <li>
              <Icon name="hide_image" />
              <div>
                <p>No proof was uploaded before the deadline</p>
              </div>
            </li>
          )}
          <li>
            <Icon name={captured.cents > 0 ? 'payments' : 'lock_open'} />
            <div>
              <p>
                {captured.cents === 0
                  ? 'Hold released in full'
                  : released.cents === 0
                    ? `${formatMoney(captured)} charged`
                    : `${formatMoney(captured)} charged, ${formatMoney(released)} released`}
              </p>
              {stake.settledAt ? (
                <p className="body-small muted"><LocalTime iso={iso(stake.settledAt)} /></p>
              ) : null}
            </div>
          </li>
          {goal.refund ? (
            <li>
              <Icon name="undo" />
              <div>
                <p>{formatMoney(refunded)} refunded after your appeal was upheld</p>
              </div>
            </li>
          ) : null}
        </ol>
      </section>

      <section className="card outlined stack" aria-labelledby="ids-heading">
        <h2 id="ids-heading" className="title">
          PayPal references
        </h2>
        <dl className="kv">
          {stake.orderId ? (
            <>
              <dt>Order ID</dt>
              <dd className="id">{stake.orderId}</dd>
            </>
          ) : null}
          {stake.authorizationId ? (
            <>
              <dt>Authorization ID</dt>
              <dd className="id">{stake.authorizationId}</dd>
            </>
          ) : null}
          {stake.captureId ? (
            <>
              <dt>Capture ID</dt>
              <dd className="id">{stake.captureId}</dd>
            </>
          ) : null}
          {goal.refund ? (
            <>
              <dt>Refund ID</dt>
              <dd className="id">{goal.refund.refundId}</dd>
            </>
          ) : null}
          {stake.holdStatus ? (
            <>
              <dt>Hold status at PayPal</dt>
              <dd>{stake.holdStatus.replace('_', ' ').toLowerCase()}</dd>
            </>
          ) : null}
          <dt>Receipt for</dt>
          <dd>{user.email}</dd>
        </dl>
        <p className="body-small muted">PayPal sandbox. No real money moved.</p>
      </section>

      <div className="row wrap">
        <PrintButton />
      </div>
    </AppShell>
  );
}
