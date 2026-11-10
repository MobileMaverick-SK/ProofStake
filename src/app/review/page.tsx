import type { Metadata } from 'next';
import Link from 'next/link';
import { formatMoney } from '@/app/lib/format';
import { requireReviewer } from '@/app/lib/admin';
import { askCaseAgentAction, decideAppealAction, resolveReviewAction } from '@/app/review/actions';
import { ConfirmForm } from '@/app/ui/confirm-form';
import { Findings, RulesList } from '@/app/ui/findings';
import { ReviewFrame } from '@/app/ui/review-frame';
import { SubmitButton } from '@/app/ui/submit-button';
import { Icon } from '@/app/ui/symbol';
import { LocalTime } from '@/app/ui/time';
import { getApp } from '@/composition-root';
import type { CaseAdvice, ReviewCase } from '@/core/appeals';
import { decideSettlement } from '@/core/settlement';
import { isDomainError, type Money, type ReviewDecision } from '@/core/shared';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Review queue' };

async function orNull<T>(load: Promise<T>): Promise<T | null> {
  try {
    return await load;
  } catch (error) {
    if (isDomainError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

/** Everything a reviewer needs to see for one case, gathered from the modules that own it. */
async function loadCase(reviewCase: ReviewCase) {
  const app = getApp();
  const id = reviewCase.goalId;
  const [goal, rules, slot, verdict, stake, capture] = await Promise.all([
    orNull(app.goals.getGoal(id)),
    orNull(app.proofRules.getRules(id)),
    orNull(app.proofIntake.getProofSlot(id)),
    orNull(app.verification.getVerdict(id)),
    orNull(app.settlement.getStake(id)),
    getApp().appeals.getCapture(id),
  ]);
  return { reviewCase, goal, rules: rules?.rules ?? null, slot, verdict: reviewCase.verdict ?? verdict, stake, capture };
}

const OPTIONS: { value: string; label: string; decision: ReviewDecision; partial?: boolean }[] = [
  { value: 'PASS', label: 'Goal met', decision: { outcome: 'PASS', fractionCompleted: 1 } },
  { value: 'PARTIAL_75', label: 'Three quarters done', decision: { outcome: 'PARTIAL', fractionCompleted: 0.75 }, partial: true },
  { value: 'PARTIAL_50', label: 'Half done', decision: { outcome: 'PARTIAL', fractionCompleted: 0.5 }, partial: true },
  { value: 'PARTIAL_25', label: 'A quarter done', decision: { outcome: 'PARTIAL', fractionCompleted: 0.25 }, partial: true },
  { value: 'FAIL', label: 'Not met', decision: { outcome: 'FAIL', fractionCompleted: 0 } },
];

/** What a decision will do to the money, worked out by the same policy that will carry it out. */
function effect(decision: ReviewDecision, stake: Money): string {
  const action = decideSettlement({ kind: 'VERDICT', ...decision, confidence: 1, stake });
  if (action.type === 'CAPTURE') return `charges ${formatMoney(action.amount)}`;
  return 'releases the hold';
}

const RECOMMENDATION: Record<CaseAdvice['recommendation'], { label: string; tone: string; icon: string }> = {
  PASS: { label: 'Suggests: goal met', tone: 'good', icon: 'check_circle' },
  PARTIAL: { label: 'Suggests: partly met', tone: 'warn', icon: 'incomplete_circle' },
  FAIL: { label: 'Suggests: not met', tone: 'bad', icon: 'cancel' },
  UPHOLD: { label: 'Suggests: uphold and refund', tone: 'good', icon: 'undo' },
  REJECT: { label: 'Suggests: reject the appeal', tone: 'bad', icon: 'cancel' },
  UNSURE: { label: 'No clear suggestion', tone: '', icon: 'help' },
};

/** The case agent's report, or the button that asks for one. Advice only: the decision buttons are below. */
function AgentPanel({ reviewCase, available }: { reviewCase: ReviewCase; available: boolean }) {
  const advice = reviewCase.advice;
  const suggestion = advice ? RECOMMENDATION[advice.recommendation] : null;
  return (
    <section className="agent-panel stack" aria-label="Case agent">
      <div className="row spread wrap">
        <h3 className="title row">
          <Icon name="smart_toy" />
          Case agent
        </h3>
        {advice && suggestion ? (
          <span className={`chip ${suggestion.tone}`.trim()}>
            <Icon name={suggestion.icon} className="small" />
            {suggestion.label} ({Math.round(advice.confidence * 100)}% sure)
          </span>
        ) : null}
      </div>
      {advice ? (
        <>
          <p>{advice.summary}</p>
          {advice.reasons.length > 0 ? (
            <ul className="terms body-small">
              {advice.reasons.map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          ) : null}
          <div className="stack" style={{ gap: 4 }}>
            <p className="label muted">What it looked up at PayPal</p>
            {advice.steps.length > 0 ? (
              <ul className="agent-steps">
                {advice.steps.map((step, index) => (
                  <li key={index}>
                    <Icon name={step.ok ? 'check_circle' : 'error'} className="small" />
                    <span>{step.note}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="body-small muted">Nothing: it worked from the case file alone.</p>
            )}
          </div>
          <p className="body-small muted">
            Advice only, from {advice.model}, <LocalTime iso={new Date(advice.at).toISOString()} />. The agent can look
            payments up but cannot move money. You decide.
          </p>
        </>
      ) : available ? (
        <p className="body-small muted">
          The agent re-reads the photo and rules and checks the payment at PayPal with read-only tools, then suggests a
          decision. It cannot move money.
        </p>
      ) : (
        <p className="body-small muted">The case agent needs an AI key (AI_API_KEY) on the server.</p>
      )}
      {available ? (
        <form action={askCaseAgentAction.bind(null, reviewCase.id)}>
          <SubmitButton
            pendingLabel="Investigating…"
            icon="smart_toy"
            variant={advice ? 'text' : 'tonal'}
            progressNote="The agent is reading the case and checking the payment at PayPal. This can take up to half a minute."
          >
            {advice ? 'Ask again' : 'Ask the case agent'}
          </SubmitButton>
        </form>
      ) : null}
    </section>
  );
}

function CaseCard({ data, agentAvailable }: { data: Awaited<ReturnType<typeof loadCase>>; agentAvailable: boolean }) {
  const { reviewCase, goal, rules, slot, verdict, stake, capture } = data;
  const isAppeal = reviewCase.kind === 'APPEAL';
  return (
    <li className="review-case" id={`case-${reviewCase.id}`}>
      <header>
        <span className="row wrap">
          <span className={`chip ${isAppeal ? 'bad' : 'warn'}`}>
            <Icon name={isAppeal ? 'gavel' : 'manage_search'} className="small" />
            {isAppeal ? 'Appeal against a charge' : 'Unsure verdict'}
          </span>
          {goal ? <span className="label numeric">{formatMoney(goal.stake)} stake</span> : null}
          {isAppeal && capture ? <span className="label numeric">{formatMoney(capture.amount)} charged</span> : null}
        </span>
        <span className="body-small muted">
          Opened <LocalTime iso={new Date(reviewCase.createdAt).toISOString()} />
        </span>
      </header>

      <div className="body">
        <div className="stack" style={{ gap: 4 }}>
          <p className="label muted">The goal</p>
          <h2 className="title-large">{goal?.text ?? 'Goal not found'}</h2>
          {goal ? (
            <p className="body-small muted row tight">
              <Icon name="event" className="small" />
              Due <LocalTime iso={goal.deadline.toISOString()} />
            </p>
          ) : null}
        </div>

        {isAppeal ? (
          <div className="banner info">
            <Icon name="format_quote" />
            <div className="stack" style={{ gap: 4 }}>
              <p className="label">The user says</p>
              <p>{reviewCase.appealReason}</p>
            </div>
          </div>
        ) : null}

        <div className="evidence">
          <figure>
            {slot?.proof ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={slot.proof.url} alt="The proof photo the user uploaded" />
            ) : (
              <div className="empty" style={{ padding: 32 }}>
                <Icon name="hide_image" className="large" />
                <p>No photo was uploaded.</p>
              </div>
            )}
            {slot ? (
              <figcaption className="expected-code">
                <span className="body-small">The photo must show this handwritten code</span>
                <strong>{slot.challengeCode}</strong>
              </figcaption>
            ) : null}
          </figure>
          <div className="stack">
            {rules && verdict ? (
              <Findings rules={rules} verdict={verdict} />
            ) : rules ? (
              <>
                <h3 className="title-large">The rules</h3>
                <RulesList rules={rules} />
              </>
            ) : (
              <p className="muted">No rules on record.</p>
            )}
          </div>
        </div>

        <AgentPanel reviewCase={reviewCase} available={agentAvailable} />
      </div>

      <footer>
        {isAppeal ? (
          <div className="stack">
            <p className="label">Your decision</p>
            <div className="row wrap">
              <ConfirmForm
                action={decideAppealAction.bind(null, reviewCase.id, true)}
                triggerLabel={`Uphold and refund ${capture ? formatMoney(capture.amount) : ''}`}
                triggerIcon="undo"
                title="Uphold this appeal?"
                body={`PayPal refunds ${capture ? formatMoney(capture.amount) : 'the charge'} to the user. This cannot be undone.`}
                confirmLabel="Refund"
                pendingLabel="Refunding…"
                progressNote="Asking PayPal to refund the charge."
              />
              <ConfirmForm
                action={decideAppealAction.bind(null, reviewCase.id, false)}
                triggerLabel="Reject the appeal"
                variant="outlined"
                title="Reject this appeal?"
                body="The charge stands and the user cannot appeal this goal again."
                confirmLabel="Reject"
                pendingLabel="Saving…"
              />
            </div>
          </div>
        ) : stake ? (
          <ConfirmForm
            action={resolveReviewAction.bind(null, reviewCase.id)}
            className="stack"
            triggerLabel="Record decision"
            triggerIcon="gavel"
            title="Record this decision?"
            body="PayPal releases or charges the stake straight away, as shown next to your choice. A release cannot be undone."
            confirmLabel="Record decision"
            pendingLabel="Settling…"
            progressNote="Settling the stake with PayPal."
          >
            <fieldset className="choices">
              <legend className="label">Your decision</legend>
              {OPTIONS.filter((option) => !option.partial || rules?.partialCompletion.measurable).map((option) => (
                <label className="choice" key={option.value}>
                  <input type="radio" name="decision" value={option.value} required />
                  <span>
                    {option.label}: {effect(option.decision, stake.amount)}
                  </span>
                </label>
              ))}
            </fieldset>
          </ConfirmForm>
        ) : null}
      </footer>
    </li>
  );
}

function describeResolution(done: ReviewCase): { text: string; icon: string; tone: string } {
  const resolution = done.resolution;
  if (resolution?.kind === 'APPEAL_UPHELD') {
    return { text: `Upheld, ${formatMoney(resolution.amount)} refunded`, icon: 'undo', tone: 'good' };
  }
  if (resolution?.kind === 'APPEAL_REJECTED') return { text: 'Rejected, charge stands', icon: 'cancel', tone: '' };
  if (resolution?.kind === 'REVIEW_DECIDED') {
    const { outcome, fractionCompleted } = resolution.decision;
    if (outcome === 'PASS') return { text: 'Goal met', icon: 'check_circle', tone: 'good' };
    if (outcome === 'FAIL') return { text: 'Not met', icon: 'cancel', tone: 'bad' };
    return { text: `${Math.round(fractionCompleted * 100)}% done`, icon: 'incomplete_circle', tone: 'warn' };
  }
  return { text: 'Decided', icon: 'check', tone: '' };
}

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; show?: string }>;
}) {
  await requireReviewer();
  const { error, notice, show } = await searchParams;
  const showDecided = show === 'decided';
  const showEvents = show === 'events';
  const app = getApp();
  const openCases = await app.appeals.listCases({ status: 'OPEN' });
  const resolved = (await app.appeals.listCases({ status: 'RESOLVED' })).reverse();
  const open = showDecided || showEvents ? [] : await Promise.all(openCases.map(loadCase));
  const events = showEvents ? await app.webhookLog.recent(50) : [];
  const goalText = new Map<string, string>();
  if (showDecided) {
    for (const done of resolved.slice(0, 50)) {
      if (!goalText.has(done.goalId)) goalText.set(done.goalId, (await orNull(app.goals.getGoal(done.goalId)))?.text ?? 'Goal');
    }
  }
  const unsure = openCases.filter((c) => c.kind === 'LOW_CONFIDENCE').length;
  const appeals = openCases.length - unsure;

  return (
    <ReviewFrame signedIn>
      <main className="stack loose" style={{ paddingTop: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="headline">Review queue</h1>
          <p className="muted">No money moves on a waiting case until you decide it.</p>
        </div>

        <section className="stats" aria-label="Queue summary">
          <div className="stat">
            <span className={`badge ${openCases.length > 0 ? 'warn' : 'good'}`}>
              <Icon name={openCases.length > 0 ? 'pending_actions' : 'task_alt'} />
            </span>
            <div>
              <p className="value">{openCases.length}</p>
              <p className="label-small muted">Waiting</p>
            </div>
          </div>
          <div className="stat">
            <span className="badge">
              <Icon name="manage_search" />
            </span>
            <div>
              <p className="value">{unsure}</p>
              <p className="label-small muted">Unsure verdicts</p>
            </div>
          </div>
          <div className="stat">
            <span className="badge">
              <Icon name="gavel" />
            </span>
            <div>
              <p className="value">{appeals}</p>
              <p className="label-small muted">Appeals</p>
            </div>
          </div>
        </section>

        <nav className="filter-row" aria-label="Show">
          <Link href="/review" className="filter-chip" aria-current={showDecided || showEvents ? undefined : 'page'}>
            Waiting <span className="count">{openCases.length}</span>
          </Link>
          <Link href="/review?show=decided" className="filter-chip" aria-current={showDecided ? 'page' : undefined}>
            Decided <span className="count">{resolved.length}</span>
          </Link>
          <Link href="/review?show=events" className="filter-chip" aria-current={showEvents ? 'page' : undefined}>
            PayPal events
          </Link>
        </nav>

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

        {showEvents ? (
          events.length === 0 ? (
            <div className="empty">
              <Icon name="webhook" className="large" />
              <h2 className="title-large">No PayPal events yet</h2>
              <p>
                {app.paypalWebhooks.configured
                  ? 'Verified webhook events from PayPal are listed here as they arrive.'
                  : 'Webhooks are off. Set PAYPAL_WEBHOOK_ID on the server to receive them.'}
              </p>
            </div>
          ) : (
            <ul className="goal-rows">
              {events.map((event) => (
                <li key={event.id}>
                  <div className="goal-row">
                    <span className="badge big">
                      <Icon name="webhook" />
                    </span>
                    <span>
                      <span className="title text">{event.type}</span>
                      <span className="meta">
                        <span className="body-small muted">
                          {event.resourceId ? `${event.resourceId}, ` : ''}
                          <LocalTime iso={new Date(event.receivedAt).toISOString()} />
                        </span>
                      </span>
                    </span>
                    <span className="end body-small">{event.result}</span>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : showDecided ? (
          resolved.length === 0 ? (
            <div className="empty">
              <Icon name="history" className="large" />
              <h2 className="title-large">Nothing decided yet</h2>
              <p>Cases you decide are listed here.</p>
            </div>
          ) : (
            <ul className="goal-rows">
              {resolved.slice(0, 50).map((done) => {
                const result = describeResolution(done);
                return (
                  <li key={done.id}>
                    <div className="goal-row">
                      <span className="badge big">
                        <Icon name={done.kind === 'APPEAL' ? 'gavel' : 'manage_search'} />
                      </span>
                      <span>
                        <span className="title text">{goalText.get(done.goalId)}</span>
                        <span className="meta">
                          <span className="body-small muted">
                            {done.kind === 'APPEAL' ? 'Appeal' : 'Unsure verdict'}, opened{' '}
                            <LocalTime iso={new Date(done.createdAt).toISOString()} />
                          </span>
                        </span>
                      </span>
                      <span className="end">
                        <span className={`chip ${result.tone}`.trim()}>
                          <Icon name={result.icon} className="small" />
                          {result.text}
                        </span>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : open.length === 0 ? (
          <div className="empty">
            <Icon name="inbox" className="large" />
            <h2 className="title-large">The queue is empty</h2>
            <p>Unsure verdicts and appeals appear here as they come in.</p>
          </div>
        ) : (
          <ul className="stack loose" style={{ listStyle: 'none', padding: 0 }}>
            {open.map((data) => (
              <CaseCard key={data.reviewCase.id} data={data} agentAvailable={app.aiConfigured} />
            ))}
          </ul>
        )}
      </main>
    </ReviewFrame>
  );
}
