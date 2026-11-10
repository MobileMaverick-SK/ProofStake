import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/app/lib/format';
import { acceptPactAction, declinePactAction, nudgePactAction } from '@/app/pact/actions';
import { CountedTextarea } from '@/app/ui/counted-textarea';
import { RulesList } from '@/app/ui/findings';
import { PayoutLine } from '@/app/ui/pact-status';
import { PublicFrame } from '@/app/ui/public-frame';
import { SubmitButton } from '@/app/ui/submit-button';
import { Icon } from '@/app/ui/symbol';
import { LocalTime } from '@/app/ui/time';
import { getApp } from '@/composition-root';
import { MAX_NUDGE_LENGTH, type Pact } from '@/core/pacts';
import { isDomainError } from '@/core/shared';

export const dynamic = 'force-dynamic';
// The link is a secret; keep it out of search engines and referrer headers.
export const metadata: Metadata = { title: 'Pact invite', robots: { index: false }, referrer: 'no-referrer' };

function Status({ pact }: { pact: Pact }) {
  const owner = pact.ownerName;
  switch (pact.outcome) {
    case 'PENDING':
      return (
        <section className="hero neutral stack">
          <Icon name="hourglass_top" className="large" />
          <h2 className="headline">Waiting for {owner} to place the hold</h2>
          <p>Nothing is at stake until PayPal holds the money.</p>
        </section>
      );
    case 'HELD':
      return (
        <section className="hero tertiary stack">
          <Icon name="lock" className="large" />
          <h2 className="headline">{formatMoney(pact.stake)} is on hold</h2>
          <p>
            {owner} has until <LocalTime iso={pact.deadline.toISOString()} /> to prove the goal was met.
          </p>
        </section>
      );
    case 'KEPT':
      return (
        <section className="hero stack">
          <Icon name="celebration" className="large" />
          <h2 className="headline">{owner} met the goal</h2>
          <p>The hold was released. Nothing was charged and nothing is paid to you.</p>
        </section>
      );
    case 'LOST':
      return (
        <section className="hero error stack">
          <Icon name="money_off" className="large" />
          <h2 className="headline">{owner} missed the goal</h2>
          {pact.payout ? <PayoutLine pact={pact} viewer="partner" /> : <p>You had not accepted the pact, so the money went to the charity pool.</p>}
        </section>
      );
    case 'REFUNDED':
      return (
        <section className="hero neutral stack">
          <Icon name="undo" className="large" />
          <h2 className="headline">The charge was refunded</h2>
          <p>A reviewer upheld {owner}&apos;s appeal, so nothing is paid to you.</p>
        </section>
      );
  }
}

export default async function PactPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { token } = await params;
  const { error, notice } = await searchParams;
  const app = getApp();
  await app.checkDeadlines();

  let pact: Pact;
  try {
    pact = await app.pacts.getByToken(token);
  } catch (failure) {
    if (isDomainError(failure) && failure.code === 'NOT_FOUND') notFound();
    throw failure;
  }
  const settled = pact.outcome === 'KEPT' || pact.outcome === 'LOST' || pact.outcome === 'REFUNDED';
  const windowMinutes = Math.round(app.pacts.appealWindowMs / 60_000);

  return (
    <PublicFrame reviewerLink={false}>
      <main className="pact-page stack">
        <section className="stack">
          <span className="chip">
            <Icon name="handshake" className="small" />
            Pact invite for {pact.partnerName}
          </span>
          <h1 className="headline">{pact.ownerName} wants you to hold them to a goal</h1>
          <p className="muted">
            {pact.ownerName} put {formatMoney(pact.stake)} on finishing this by the deadline. If they miss it, the money
            goes to you.
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

        <section className="card outlined stack">
          <h2 className="title">The goal</h2>
          <p className="title-large">{pact.goalText}</p>
          <dl className="kv">
            <dt>Due</dt>
            <dd>
              <LocalTime iso={pact.deadline.toISOString()} />
            </dd>
            <dt>Stake</dt>
            <dd>{formatMoney(pact.stake)}</dd>
          </dl>
          {pact.rules ? (
            <>
              <h3 className="title">The proof photo must show</h3>
              <RulesList rules={pact.rules} />
            </>
          ) : (
            <p className="body-small muted">The proof rules are still being agreed.</p>
          )}
        </section>

        <section className="card outlined stack">
          <h2 className="title">The pact</h2>
          <ul className="terms">
            <li>If {pact.ownerName} proves the goal was met, PayPal releases the hold and nobody is paid.</li>
            <li>
              If they miss it, the stake is charged and sent to your PayPal account. If they partly meet it, only the
              matching part is charged and sent.
            </li>
            <li>
              The money is sent {windowMinutes} minutes after the charge, so {pact.ownerName} has time to appeal. If a
              reviewer upholds the appeal, they are refunded and you are not paid.
            </li>
            <li>You do not judge the proof and cannot see it. An automatic check and an independent reviewer decide.</li>
            <li>This is a PayPal sandbox demo. No real money moves.</li>
          </ul>
        </section>

        {pact.status === 'INVITED' && !settled ? (
          <section className="card stack">
            <h2 className="title">Accept the pact</h2>
            <form action={acceptPactAction.bind(null, token)} className="stack">
              <div className="field">
                <label htmlFor="payoutEmail">Your PayPal email</label>
                <input id="payoutEmail" name="payoutEmail" type="email" required maxLength={200} defaultValue={pact.partnerEmail} />
                <span className="hint">Where the money is sent if the goal is missed. In this demo, use a sandbox Personal account.</span>
              </div>
              <label className="check">
                <input type="checkbox" name="agree" required />
                <span>I agree to the pact above.</span>
              </label>
              <div>
                <SubmitButton pendingLabel="Accepting…" icon="handshake">
                  Accept pact
                </SubmitButton>
              </div>
            </form>
            <form action={declinePactAction.bind(null, token)}>
              <SubmitButton pendingLabel="Declining…" variant="text">
                No thanks, decline
              </SubmitButton>
            </form>
          </section>
        ) : null}

        {pact.status === 'INVITED' && settled ? (
          <section className="hero neutral stack">
            <Icon name="event_busy" className="large" />
            <h2 className="headline">This goal is already settled</h2>
            <p>The pact was not accepted in time, so it no longer applies.</p>
          </section>
        ) : null}

        {pact.status === 'DECLINED' ? (
          <section className="hero neutral stack">
            <Icon name="do_not_disturb_on" className="large" />
            <h2 className="headline">You declined this pact</h2>
            <p>Nothing will be sent to you. If {pact.ownerName} misses the goal, the money goes to the charity pool.</p>
          </section>
        ) : null}

        {pact.status === 'ACCEPTED' ? (
          <>
            <Status pact={pact} />
            <p className="body-small muted">
              You accepted this pact. Payouts go to <strong>{pact.payoutEmail}</strong>. Keep this link to check on the
              goal.
            </p>
            {pact.nudge ? (
              <section className="card outlined stack">
                <h2 className="title">Your message to {pact.ownerName}</h2>
                <blockquote className="quote">{pact.nudge.text}</blockquote>
              </section>
            ) : !settled ? (
              <section className="card outlined stack">
                <h2 className="title">Send {pact.ownerName} one message</h2>
                <form action={nudgePactAction.bind(null, token)} className="stack">
                  <CountedTextarea
                    id="message"
                    name="message"
                    label="A push, a joke, a threat to spend it on pizza"
                    minLength={1}
                    maxLength={MAX_NUDGE_LENGTH}
                    hint="You can send one message per goal. It appears on their goal screen."
                    rows={2}
                  />
                  <div>
                    <SubmitButton pendingLabel="Sending…" icon="send" variant="tonal">
                      Send message
                    </SubmitButton>
                  </div>
                </form>
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </PublicFrame>
  );
}
