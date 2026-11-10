import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  acceptResultAction,
  acceptRulesAction,
  fileAppealAction,
  holdWithSavedAction,
  regenerateRulesAction,
  retrySettlementAction,
} from '@/app/actions';
import { headers } from 'next/headers';
import { formatMoney } from '@/app/lib/format';
import { publicOrigin } from '@/app/lib/origin';
import { requireUser } from '@/app/lib/session';
import { AppShell } from '@/app/ui/app-shell';
import { RefreshAt } from '@/app/ui/auto-refresh';
import { LiveUpdates } from '@/app/ui/live-updates';
import { goalPulse } from '@/app/lib/pulse';
import { ConfirmForm } from '@/app/ui/confirm-form';
import { CopyButton } from '@/app/ui/copy-button';
import { CountedTextarea } from '@/app/ui/counted-textarea';
import { StateChip } from '@/app/ui/goal-view';
import { Icon } from '@/app/ui/symbol';
import { Findings, RulesList } from '@/app/ui/findings';
import { ApiActivity } from '@/app/ui/api-activity';
import { PayoutLine } from '@/app/ui/pact-status';
import { PayPalHoldButton } from '@/app/ui/paypal-hold-button';
import { ProofUploadForm } from '@/app/ui/proof-upload-form';
import { SubmitButton } from '@/app/ui/submit-button';
import { Countdown, LocalTime, TimeRing } from '@/app/ui/time';
import { getApp } from '@/composition-root';
import { isExpiredWithoutHold, type Goal, type GoalState } from '@/core/goals';
import type { Pact } from '@/core/pacts';
import { MAX_PROOF_ATTEMPTS } from '@/core/proof-intake';
import { decideSettlement, type StakeRecord } from '@/core/settlement';
import { isDomainError, usd, type ProofRules, type Verdict } from '@/core/shared';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Goal' };

/** A record that may not exist yet is "nothing to show", not an error. */
async function orNull<T>(load: Promise<T>): Promise<T | null> {
  try {
    return await load;
  } catch (error) {
    if (isDomainError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

const STEPS = ['Rules', 'Hold', 'Proof', 'Result'];
const STEP_OF: Record<GoalState, number> = {
  DRAFT: 0,
  RULES_PROPOSED: 0,
  AWAITING_STAKE: 1,
  ACTIVE: 2,
  PROOF_SUBMITTED: 2,
  IN_REVIEW: 3,
  SETTLED_RELEASED: 4,
  SETTLED_PARTIAL: 4,
  SETTLED_FORFEITED: 4,
  REFUNDED: 4,
};

function Steps({ state }: { state: GoalState }) {
  const current = STEP_OF[state];
  return (
    <ol className="steps" aria-label="Progress">
      {STEPS.map((step, index) => (
        <li
          key={step}
          className={index < current ? 'done' : index === current ? 'current' : undefined}
          aria-current={index === current ? 'step' : undefined}
        >
          {index < current ? <Icon name="check" /> : null}
          {step}
        </li>
      ))}
    </ol>
  );
}

/** The result is decided; PayPal has not confirmed the money movement yet. */
function SettlingCard({ goalId, stake }: { goalId: string; stake: StakeRecord | null }) {
  const action = stake?.pendingAction;
  return (
    <section className="card tertiary stack" role="status">
      <h2 className="title-large">Finishing up with PayPal</h2>
      <p>
        The result is decided
        {action?.type === 'CAPTURE' ? `: charge ${formatMoney(action.amount)}` : action?.type === 'RELEASE' ? ': release the hold' : ''}
        . PayPal has not confirmed it yet. We try again every 30 seconds.
      </p>
      {stake?.lastError ? (
        <p className="body-small">
          Last attempt, <LocalTime iso={new Date(stake.lastError.at).toISOString()} />: {stake.lastError.message}
        </p>
      ) : null}
      <form action={retrySettlementAction.bind(null, goalId)}>
        <SubmitButton
          pendingLabel="Asking PayPal…"
          icon="refresh"
          variant="outlined"
          progressNote="Waiting for PayPal to answer."
        >
          Try PayPal again now
        </SubmitButton>
      </form>
    </section>
  );
}

function Receipt({ goal, stake }: { goal: Goal; stake: StakeRecord }) {
  const captured = stake.capturedAmount ?? usd(0);
  const settled = stake.status === 'RELEASED' || stake.status === 'CAPTURED';
  return (
    <section className="card outlined stack" aria-labelledby="receipt-heading">
      <h2 id="receipt-heading" className="title row">
        <Icon name="receipt_long" />
        Money
      </h2>
      <dl className="kv">
        <dt>Held by PayPal</dt>
        <dd>{formatMoney(stake.amount)}</dd>
        {settled ? (
          <>
            <dt>Charged to you</dt>
            <dd>{formatMoney(captured)}</dd>
            <dt>Released back to you</dt>
            <dd>{formatMoney(usd(stake.amount.cents - captured.cents))}</dd>
          </>
        ) : null}
        {goal.refund ? (
          <>
            <dt>Refunded</dt>
            <dd>{formatMoney(goal.refund.amount)}</dd>
          </>
        ) : null}
        {stake.holdStatus ? (
          <>
            <dt>PayPal hold status</dt>
            <dd>{stake.holdStatus.replace('_', ' ').toLowerCase()}</dd>
          </>
        ) : null}
        {stake.providerNotifiedAt ? (
          <>
            <dt>Last PayPal webhook</dt>
            <dd>
              <LocalTime iso={new Date(stake.providerNotifiedAt).toISOString()} />
            </dd>
          </>
        ) : null}
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
      </dl>
      <p className="body-small muted">PayPal sandbox. No real money moves.</p>
      {settled ? (
        <div>
          <Link href={`/goals/${goal.id}/receipt`} className="button tonal">
            <Icon name="receipt_long" />
            View receipt
          </Link>
        </div>
      ) : null}
    </section>
  );
}

/** The agreement with the person who receives a lost stake, and where that money is. */
function PactCard({ pact, inviteUrl }: { pact: Pact; inviteUrl: string }) {
  const settled = pact.outcome === 'KEPT' || pact.outcome === 'LOST' || pact.outcome === 'REFUNDED';
  const chip =
    pact.status === 'ACCEPTED'
      ? { label: 'Accepted', icon: 'check_circle', tone: 'good' }
      : pact.status === 'DECLINED'
        ? { label: 'Declined', icon: 'cancel', tone: '' }
        : { label: settled ? 'Not accepted' : 'Waiting for them', icon: 'hourglass_top', tone: settled ? '' : 'warn' };
  return (
    <section className="card outlined stack" aria-labelledby="pact-heading">
      <div className="row spread wrap">
        <h2 id="pact-heading" className="title row">
          <Icon name="handshake" />
          Pact with {pact.partnerName}
        </h2>
        <span className={`chip ${chip.tone}`}>
          <Icon name={chip.icon} className="small" />
          {chip.label}
        </span>
      </div>

      {pact.status === 'INVITED' && !settled ? (
        <>
          <p className="body-small">
            Send {pact.partnerName} this link. Until they accept, a lost stake goes to the charity pool instead.
          </p>
          <p className="invite-link">{inviteUrl}</p>
          <div>
            <CopyButton value={inviteUrl} label="Copy invite link" />
          </div>
        </>
      ) : null}
      {pact.status === 'INVITED' && settled ? (
        <p className="body-small muted">{pact.partnerName} did not accept in time, so the pact did not apply to this goal.</p>
      ) : null}
      {pact.status === 'DECLINED' ? (
        <p className="body-small muted">{pact.partnerName} declined. A lost stake goes to the charity pool.</p>
      ) : null}
      {pact.status === 'ACCEPTED' && !settled ? (
        <p className="body-small">
          If you miss this goal, the charge goes to {pact.partnerName}. They cannot see or judge your proof.
        </p>
      ) : null}
      {pact.status === 'ACCEPTED' && pact.outcome === 'KEPT' ? (
        <p className="body-small muted">You met the goal, so nothing goes to {pact.partnerName}.</p>
      ) : null}

      {pact.nudge ? (
        <figure className="stack" style={{ gap: 4, margin: 0 }}>
          <blockquote className="quote">{pact.nudge.text}</blockquote>
          <figcaption className="body-small muted">From {pact.partnerName}</figcaption>
        </figure>
      ) : null}

      {pact.payout ? (
        <div className="body-small stack" style={{ gap: 8 }}>
          <PayoutLine pact={pact} viewer="owner" />
          {pact.payout.payoutId ? (
            <dl className="kv">
              <dt>Payout ID</dt>
              <dd className="id">{pact.payout.payoutId}</dd>
            </dl>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Outcome({ goal, stake, pact }: { goal: Goal; stake: StakeRecord | null; pact: Pact | null }) {
  const captured = stake?.capturedAmount ?? usd(0);
  const payout = pact?.payout;
  const destination =
    payout?.status === 'SENT'
      ? `went to ${pact!.partnerName}`
      : payout && payout.status !== 'CANCELLED'
        ? `is set aside for ${pact!.partnerName}`
        : 'went to the charity pool';
  const released = usd(goal.stake.cents - captured.cents);
  switch (goal.state) {
    case 'SETTLED_RELEASED':
      return (
        <section className="hero stack">
          <Icon name="celebration" className="large" />
          <h2 className="headline">You kept your {formatMoney(goal.stake)}</h2>
          <p>
            {stake?.endedAtProvider
              ? 'The hold ended at PayPal before the goal was settled, so nothing was charged.'
              : 'Goal met. The hold was released and nothing was charged.'}
          </p>
        </section>
      );
    case 'SETTLED_PARTIAL':
      return (
        <section className="hero tertiary stack">
          <Icon name="incomplete_circle" className="large" />
          <h2 className="headline">Partly met: {formatMoney(captured)} charged</h2>
          <p>
            {formatMoney(captured)} {destination}. The other {formatMoney(released)} was released back to you.
          </p>
        </section>
      );
    case 'SETTLED_FORFEITED':
      return (
        <section className="hero error stack">
          <Icon name="money_off" className="large" />
          <h2 className="headline">{formatMoney(captured)} charged</h2>
          <p>The goal was not met by the deadline, so the full stake {destination}.</p>
        </section>
      );
    case 'REFUNDED':
      return (
        <section className="hero stack">
          <Icon name="undo" className="large" />
          <h2 className="headline">Refunded</h2>
          <p>Your appeal was upheld and the charge was refunded.</p>
        </section>
      );
    default:
      return null;
  }
}

export default async function GoalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { error, notice } = await searchParams;
  const app = getApp();
  await app.checkDeadlines();

  const goal = await orNull(app.goals.getOwnedGoal(user.id, id));
  if (!goal) notFound();
  const pact = await app.pacts.getForGoal(id);
  const pulse = await goalPulse(id);
  const inviteUrl = pact ? `${publicOrigin(await headers())}/pact/${pact.token}` : '';
  const payoutDue = pact?.payout?.status === 'SCHEDULED' ? pact.payout.dueAt.toISOString() : null;
  const [rulesRecord, slot, stake, verdict, cases] = await Promise.all([
    orNull(app.proofRules.getRules(id)),
    orNull(app.proofIntake.getProofSlot(id)),
    orNull(app.settlement.getStake(id)),
    orNull(app.verification.getVerdict(id)),
    app.appeals.listCases({ goalId: id }),
  ]);
  const paypalCalls = await app.paypalCalls.forResources([
    id,
    stake?.orderId ?? '',
    stake?.authorizationId ?? '',
    stake?.captureId ?? '',
    goal.refund?.refundId ?? '',
    pact?.payout?.payoutId ?? '',
  ]);
  const savedMethod = goal.state === 'AWAITING_STAKE' ? await app.settlement.getSavedMethod(user.id) : null;
  const appeal = cases.find((reviewCase) => reviewCase.kind === 'APPEAL') ?? null;
  const charged = goal.state === 'SETTLED_PARTIAL' || goal.state === 'SETTLED_FORFEITED';
  const rules = rulesRecord?.rules ?? null;
  const deadline = goal.deadline.toISOString();
  const holdExists = Boolean(stake?.authorizationId);
  const expired = isExpiredWithoutHold(goal, new Date());
  const showRulesAside = rules && (goal.state === 'AWAITING_STAKE' || goal.state === 'ACTIVE');
  const uploadsLeft = MAX_PROOF_ATTEMPTS - (slot?.attempts ?? 0);
  // PayPal has been told what to do but has not confirmed it yet (it is retried automatically).
  const settling = Boolean(stake?.pendingAction);
  // A proof that was not approved, which the user may still replace with a better one.
  const retryVerdict = goal.state === 'ACTIVE' && !settling ? (stake?.deferredVerdict ?? null) : null;
  const ifAccepted = retryVerdict
    ? decideSettlement({
        kind: 'VERDICT',
        outcome: retryVerdict.outcome,
        confidence: retryVerdict.confidence,
        fractionCompleted: retryVerdict.fractionCompleted,
        stake: goal.stake,
        confidenceThreshold: app.confidenceThreshold,
      })
    : null;

  return (
    <AppShell user={user} active="goals" title="Goal" backHref="/goals">
      <Steps state={goal.state} />

      <section className="stack">
        <div className="row spread wrap">
          <StateChip goal={goal} />
          <span className="row tight">
            <LiveUpdates url={`/api/goals/${goal.id}/pulse`} version={pulse.version} nextCheckMs={pulse.nextCheckMs} />
            <span className="label numeric">{formatMoney(goal.stake)} stake</span>
          </span>
        </div>
        <h2 className="headline">{goal.text}</h2>
        <p className="body-small muted row tight">
          <Icon name="event" className="small" />
          Due <LocalTime iso={deadline} />
        </p>
      </section>

      {error ? (
        <div className="banner" role="alert">
          <Icon name="error" />
          <p className="body-small">{error}</p>
        </div>
      ) : null}

      {notice ? (
        <div className="banner info" role="status">
          <Icon name="check_circle" />
          <p className="body-small">{notice}</p>
        </div>
      ) : null}

      {goal.state === 'ACTIVE' || goal.state === 'AWAITING_STAKE' || goal.state === 'RULES_PROPOSED' ? (
        <RefreshAt iso={deadline} delayMs={goal.state === 'ACTIVE' ? 35_000 : 1000} />
      ) : null}

      <div className="detail">
        <div>
          {expired ? (
            <section className="hero neutral stack">
              <Icon name="timer_off" className="large" />
              <h2 className="headline">This goal expired</h2>
              <p>The deadline passed before a hold was placed, so no money was held and nothing was charged.</p>
              <div>
                <Link href="/goals/new" className="button filled">
                  <Icon name="add" />
                  Set a new goal
                </Link>
              </div>
            </section>
          ) : null}

          {goal.state === 'DRAFT' && !expired ? (
            <section className="card stack">
              <h2 className="title">The proof rules could not be written</h2>
              <p className="muted">
                The AI service did not answer. Nothing was held. Ask for the rules again in a moment.
              </p>
              <form action={regenerateRulesAction.bind(null, goal.id)}>
                <SubmitButton pendingLabel="Writing rules…" icon="refresh" progressNote="The AI is writing proof rules for this goal. This takes a few seconds.">
                  Write the rules again
                </SubmitButton>
              </form>
            </section>
          ) : null}

          {goal.state === 'RULES_PROPOSED' && rules && !expired ? (
            <section className="card stack">
              <h2 className="title-large">Your proof must show</h2>
              <RulesList rules={rules} />
              <p className="body-small muted">
                {rules.partialCompletion.measurable
                  ? `Partly done counts in proportion. ${rules.partialCompletion.description ?? ''}`
                  : 'This goal is all or nothing.'}
              </p>
              <form action={acceptRulesAction.bind(null, goal.id)}>
                <SubmitButton pendingLabel="Saving…" icon="check" block>
                  Accept these rules
                </SubmitButton>
              </form>
              <form action={regenerateRulesAction.bind(null, goal.id)}>
                <SubmitButton
                  pendingLabel="Writing new rules…"
                  icon="refresh"
                  variant="text"
                  block
                  progressNote="The AI is writing proof rules for this goal. This takes a few seconds."
                >
                  Write different rules
                </SubmitButton>
              </form>
            </section>
          ) : null}

          {goal.state === 'AWAITING_STAKE' && !expired ? (
            <section className="card stack">
              <h2 className="title-large">Place a {formatMoney(goal.stake)} hold</h2>
              <ul className="list">
                <li>
                  <Icon name="lock" />
                  <p className="grow">PayPal holds {formatMoney(goal.stake)}. You are not charged now.</p>
                </li>
                <li>
                  <Icon name="check_circle" />
                  <p className="grow">Meet the goal and the hold is released in full.</p>
                </li>
                <li>
                  <Icon name="volunteer_activism" />
                  <p className="grow">Miss it and the stake goes to the charity pool, never to another user.</p>
                </li>
              </ul>
              {app.paypalConfigured && savedMethod ? (
                <>
                  <div className="row">
                    <span className="badge good">
                      <Icon name="account_balance_wallet" />
                    </span>
                    <div className="grow stack" style={{ gap: 2 }}>
                      <p className="title">Your saved PayPal account</p>
                      <p className="body-small muted" style={{ overflowWrap: 'anywhere' }}>
                        {savedMethod.label ?? 'Saved for one-tap holds'}
                      </p>
                    </div>
                  </div>
                  <ConfirmForm
                    action={holdWithSavedAction.bind(null, goal.id)}
                    triggerLabel={`Place the ${formatMoney(goal.stake)} hold`}
                    triggerIcon="lock"
                    title={`Hold ${formatMoney(goal.stake)}?`}
                    body={`PayPal holds ${formatMoney(goal.stake)} on ${savedMethod.label ?? 'your saved PayPal account'} until this goal is settled. Nothing is charged now.`}
                    confirmLabel="Place hold"
                    pendingLabel="Placing the hold…"
                  />
                  <details className="disclosure">
                    <summary>
                      <Icon name="swap_horiz" />
                      Use a different PayPal account
                    </summary>
                    <PayPalHoldButton goalId={goal.id} clientId={app.paypalClientId} />
                  </details>
                </>
              ) : app.paypalConfigured ? (
                <PayPalHoldButton goalId={goal.id} clientId={app.paypalClientId} />
              ) : (
                <div className="banner" role="alert">
                  <Icon name="key_off" />
                  <p className="body-small">
                    PayPal is not set up on this server. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env and
                    restart.
                  </p>
                </div>
              )}
            </section>
          ) : null}

          {goal.state === 'ACTIVE' && slot ? (
            <>
              <section className="hero tertiary" aria-label="Time left">
                <div className="row" style={{ gap: 20 }}>
                  <TimeRing start={goal.createdAt.toISOString()} deadline={deadline}>
                    <Icon name="timer" className="large" />
                  </TimeRing>
                  <div className="grow stack" style={{ gap: 4 }}>
                    <p className="label">Time left</p>
                    <p className="timer">
                      <Countdown deadline={deadline} />
                    </p>
                  </div>
                </div>
              </section>
              <section className="card stack">
                <h2 className="title-large">Your one-time code</h2>
                <p className="code" aria-label={`Code ${slot.challengeCode.split('').join(' ')}`}>
                  {slot.challengeCode}
                </p>
                <p className="body-small muted">
                  Write this code by hand on paper and put it in the photo, next to your work. It proves the photo was
                  taken for this goal.
                </p>
                <div>
                  <CopyButton value={slot.challengeCode} label="Copy code" />
                </div>
              </section>
              {retryVerdict && rules ? (
                <section className="card stack">
                  <div className="banner">
                    <Icon name="error" />
                    <p className="body-small">
                      Your last photo was not approved. No money has moved. You can upload a better photo before the
                      deadline.
                    </p>
                  </div>
                  <Findings rules={rules} verdict={retryVerdict} />
                </section>
              ) : null}
              {settling ? (
                <SettlingCard goalId={goal.id} stake={stake} />
              ) : (
                <section className="card stack">
                  <h2 className="title-large">{retryVerdict ? 'Upload a new photo' : 'Upload your proof'}</h2>
                  <p className="body-small muted">
                    {uploadsLeft === 1
                      ? 'This is your last upload. Its result is final.'
                      : `You have ${uploadsLeft} uploads left. A new photo replaces the previous result.`}
                  </p>
                  <ProofUploadForm goalId={goal.id} simulate={!app.aiConfigured} />
                </section>
              )}
              {retryVerdict && ifAccepted ? (
                <section className="card outlined stack">
                  <h2 className="title">Or stop here</h2>
                  <p className="body-small muted">
                    {ifAccepted.type === 'CAPTURE'
                      ? `Taking this result as final charges ${formatMoney(ifAccepted.amount)} now${ifAccepted.partial ? ' and releases the rest' : ''}.`
                      : ifAccepted.type === 'RELEASE'
                        ? 'Taking this result as final releases the hold in full.'
                        : 'Taking this result as final sends it to a person for review. Nothing is charged until they decide.'}{' '}
                    If you do nothing, the same happens at the deadline.
                  </p>
                  <ConfirmForm
                    action={acceptResultAction.bind(null, goal.id)}
                    triggerLabel="Take this result as final"
                    variant="outlined"
                    title="Take this result as final?"
                    body={
                      ifAccepted.type === 'CAPTURE'
                        ? `PayPal charges ${formatMoney(ifAccepted.amount)} now. You will not be able to upload another photo.`
                        : ifAccepted.type === 'RELEASE'
                          ? 'The hold is released in full and the goal is closed.'
                          : 'The result goes to a reviewer. You will not be able to upload another photo.'
                    }
                    confirmLabel="Yes, finish now"
                    pendingLabel="Settling…"
                  />
                </section>
              ) : null}
            </>
          ) : null}

          {goal.state === 'PROOF_SUBMITTED' ? (
            settling ? (
              <SettlingCard goalId={goal.id} stake={stake} />
            ) : (
              <section className="card stack" role="status">
                <h2 className="title-large">Checking your proof</h2>
                <div className="progress" />
                <p className="muted">This usually takes a few seconds.</p>
                <div>
                  <Link href={`/goals/${goal.id}`} className="button tonal">
                    <Icon name="refresh" />
                    Check again
                  </Link>
                </div>
              </section>
            )
          ) : null}

          {goal.state === 'IN_REVIEW' && settling ? <SettlingCard goalId={goal.id} stake={stake} /> : null}

          {goal.state === 'IN_REVIEW' && !settling ? (
            <section className="hero tertiary stack">
              <Icon name="manage_search" className="large" />
              <h2 className="headline">A person will check this one</h2>
              <p>
                The automatic check was not sure. Your money stays on hold and nothing is charged until a reviewer
                decides.
              </p>
            </section>
          ) : null}

          <Outcome goal={goal} stake={stake} pact={pact} />
          {payoutDue ? <RefreshAt iso={payoutDue} delayMs={35_000} /> : null}

          {charged && !appeal && pact?.payout?.status !== 'SENT' ? (
            <section className="card outlined stack">
              <h2 className="title">Think this is wrong?</h2>
              <p className="body-small muted">
                Tell a reviewer why. If they agree, the {formatMoney(goal.capture?.amount ?? goal.stake)} charge is
                refunded. You can appeal once per goal.
                {payoutDue ? (
                  <>
                    {' '}Appeal before <LocalTime iso={payoutDue} />: after that the money is sent to {pact!.partnerName} and
                    cannot be refunded.
                  </>
                ) : null}
              </p>
              <form action={fileAppealAction.bind(null, goal.id)} className="stack">
                <CountedTextarea
                  id="reason"
                  name="reason"
                  label="What did the check get wrong?"
                  minLength={5}
                  maxLength={1000}
                  hint="Be specific: the reviewer sees your photo and this note."
                  rows={3}
                />
                <div>
                  <SubmitButton pendingLabel="Sending…" icon="gavel" variant="tonal">
                    Send appeal
                  </SubmitButton>
                </div>
              </form>
            </section>
          ) : null}

          {appeal ? (
            <section className="card outlined stack">
              <div className="row spread wrap">
                <h2 className="title">Your appeal</h2>
                <span className={`chip ${appeal.status === 'OPEN' ? 'warn' : appeal.resolution?.kind === 'APPEAL_UPHELD' ? 'good' : ''}`}>
                  <Icon
                    name={appeal.status === 'OPEN' ? 'hourglass_top' : appeal.resolution?.kind === 'APPEAL_UPHELD' ? 'check_circle' : 'cancel'}
                    className="small"
                  />
                  {appeal.status === 'OPEN'
                    ? 'Waiting for a reviewer'
                    : appeal.resolution?.kind === 'APPEAL_UPHELD'
                      ? 'Upheld and refunded'
                      : 'Rejected'}
                </span>
              </div>
              <p className="body-small muted">{appeal.appealReason}</p>
              {appeal.status === 'RESOLVED' && appeal.resolution?.kind === 'APPEAL_REJECTED' ? (
                <p className="body-small">A reviewer looked at this and the charge stands.</p>
              ) : null}
            </section>
          ) : null}

          {verdict && rules && !retryVerdict && goal.state !== 'ACTIVE' ? (
            <section className="card stack">
              <Findings rules={rules} verdict={verdict} />
            </section>
          ) : null}
        </div>

        <div>
          {showRulesAside ? (
            <section className="card outlined stack">
              <h2 className="title">Your proof must show</h2>
              <RulesList rules={rules} />
            </section>
          ) : null}

          {slot?.proof ? (
            <section className="card outlined stack">
              <h2 className="title">Your proof</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slot.proof.url} alt="The proof photo you uploaded" style={{ width: '100%', borderRadius: 12 }} />
            </section>
          ) : null}

          {pact ? <PactCard pact={pact} inviteUrl={inviteUrl} /> : null}

          {stake && holdExists ? <Receipt goal={goal} stake={stake} /> : null}

          <ApiActivity calls={paypalCalls} />
        </div>
      </div>
    </AppShell>
  );
}
