'use client';

import { useActionState, useEffect, useState } from 'react';
import type { DraftState } from '@/app/lib/draft-state';
import type { FormState } from '@/app/lib/form-state';
import { DeadlinePicker } from './deadline-picker';
import { SubmitButton } from './submit-button';
import { Icon } from './symbol';
import { useKeptForm } from './use-kept-form';

const QUICK_STAKES = ['5.00', '10.00', '20.00', '50.00'];
const MAX_TEXT = 500;

const PROVABILITY = [
  '',
  'A photo cannot show this',
  'Hard to show in a photo',
  'A photo can partly show this',
  'A photo shows this well',
  'A photo settles it',
];

/** The goal agent: the user describes the goal in a sentence, and the agent fills the form below. */
function GoalAgent({
  action,
  onDraft,
}: {
  action: (state: DraftState, form: FormData) => Promise<DraftState>;
  onDraft: (draft: NonNullable<DraftState['draft']>) => void;
}) {
  const [state, submit, pending] = useActionState(action, {});
  const [timeZone, setTimeZone] = useState('UTC');
  // Controlled, so the sentence stays on screen after the agent answers.
  const [request, setRequest] = useState('');
  useEffect(() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'), []);
  const draft = state.draft;
  useEffect(() => {
    if (draft) onDraft(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.key]);

  return (
    <section className="agent-panel stack" aria-labelledby="goal-agent-heading">
      <h2 id="goal-agent-heading" className="title row">
        <Icon name="smart_toy" />
        Say it in a sentence
      </h2>
      <form action={submit} className="stack">
        <input type="hidden" name="timeZone" value={timeZone} />
        <div className="field">
          <label htmlFor="request" className="visually-hidden">
            Describe your goal in your own words
          </label>
          <textarea
            id="request"
            name="request"
            required
            minLength={5}
            maxLength={600}
            rows={2}
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="Finish my thesis chapter by Friday 9pm, $20, and my wife Priya gets it if I don't"
          />
        </div>
        <SubmitButton
          pending={pending}
          pendingLabel="Drafting…"
          icon="auto_awesome"
          variant="tonal"
          progressNote="The agent is checking the time, your earlier goals and the app's rules. This takes a few seconds."
        >
          Draft it for me
        </SubmitButton>
      </form>
      {state.error ? (
        <div className="banner" role="alert">
          <Icon name="error" />
          <p className="body-small">{state.error}</p>
        </div>
      ) : null}
      {draft && !pending ? (
        <div className="stack" role="status" style={{ gap: 12 }}>
          <p className="row tight wrap">
            <span className={`chip ${draft.provability >= 4 ? 'good' : draft.provability === 3 ? 'warn' : 'bad'}`}>
              <Icon name="photo_camera" className="small" />
              {PROVABILITY[draft.provability]} ({draft.provability}/5)
            </span>
            <span className="body-small muted">The form below is filled in. Check it, then continue. Nothing is saved yet.</span>
          </p>
          {draft.changes.length > 0 ? (
            <ul className="terms body-small">
              {draft.changes.map((change, index) => (
                <li key={index}>{change}</li>
              ))}
            </ul>
          ) : null}
          {[...draft.questions, ...draft.problems].length > 0 ? (
            <div className="stack" style={{ gap: 4 }}>
              <p className="label">Still yours to decide</p>
              <ul className="terms body-small">
                {[...new Set([...draft.questions, ...draft.problems])].map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {draft.steps.length > 0 ? (
            <ul className="agent-steps">
              {draft.steps.map((step, index) => (
                <li key={index}>
                  <Icon name="check_circle" className="small" />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function NewGoalForm({
  action,
  draftAction,
  savedAccount,
}: {
  /** The goal agent. Absent when no AI service is configured. */
  draftAction?: (state: DraftState, form: FormData) => Promise<DraftState>;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  /** The user's saved PayPal account, if they have one: the hold will then take one tap. */
  savedAccount?: string | null;
}) {
  const { state, pending, onSubmit } = useKeptForm(action);
  const [stake, setStake] = useState('20.00');
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [destination, setDestination] = useState<'charity' | 'partner'>('charity');
  const [partnerName, setPartnerName] = useState('');
  const [partnerEmail, setPartnerEmail] = useState('');
  const [text, setText] = useState('');
  const [suggestedDeadline, setSuggestedDeadline] = useState<{
    iso: string;
    key: number;
  } | null>(null);

  /** Puts the agent's draft into the form. Fields the agent left empty keep what the user had. */
  function applyDraft(draft: NonNullable<DraftState['draft']>) {
    setText(draft.text);
    if (draft.stake) setStake(draft.stake);
    if (draft.deadlineIso) setSuggestedDeadline({ iso: draft.deadlineIso, key: draft.key });
    if (draft.partner) {
      setDestination('partner');
      setPartnerName(draft.partner.name);
      setPartnerEmail(draft.partner.email);
    }
  }

  const validStake = /^\d+(\.\d{1,2})?$/.test(stake) && Number(stake) >= 1 && Number(stake) <= 500;
  const amount = validStake ? `$${Number(stake).toFixed(2)}` : null;
  const due = deadline
    ? deadline.toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="simple-form">
      {draftAction ? <GoalAgent action={draftAction} onDraft={applyDraft} /> : null}
      <form onSubmit={onSubmit} className="simple-form">
        {state.error ? (
          <div className="banner" role="alert">
            <Icon name="error" />
            <p className="body-small">{state.error}</p>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="text" className="question">
            What will you finish?
          </label>
          <textarea
            id="text"
            name="text"
            required
            minLength={5}
            maxLength={MAX_TEXT}
            rows={3}
            placeholder="Finish my chapter 3 notes, all 12 pages"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <span className="hint">Something a photo can show. Say how much: pages, items, problems.</span>
        </div>

        <div className="field">
          <span className="question" id="due-label">
            When is it due?
          </span>
          <DeadlinePicker onDeadline={setDeadline} exact={suggestedDeadline} />
        </div>

        <div className="field">
          <label htmlFor="stake" className="question">
            How much will you stake?
          </label>
          <div className="stake-row">
            <div className="money-input">
              <input
                id="stake"
                name="stake"
                type="text"
                inputMode="decimal"
                required
                pattern="\d+(\.\d{1,2})?"
                value={stake}
                onChange={(event) => setStake(event.target.value.replace(/[^\d.]/g, ''))}
              />
            </div>
            <div className="choices" role="group" aria-label="Quick amounts">
              {QUICK_STAKES.map((option) => (
                <button
                  type="button"
                  key={option}
                  className={`quick-chip${stake === option ? ' selected' : ''}`}
                  onClick={() => setStake(option)}
                >
                  ${option.replace('.00', '')}
                </button>
              ))}
            </div>
          </div>
          {validStake ? null : <span className="hint">Enter an amount from $1 to $500, for example 20 or 20.50.</span>}
        </div>

        <div className="field">
          <span className="question" id="destination-label">
            If you miss it, who gets the money?
          </span>
          <input type="hidden" name="destination" value={destination} />
          <div className="choices" role="group" aria-labelledby="destination-label">
            <button
              type="button"
              className={`quick-chip${destination === 'charity' ? ' selected' : ''}`}
              aria-pressed={destination === 'charity'}
              onClick={() => setDestination('charity')}
            >
              <Icon name="volunteer_activism" className="small" />
              Charity pool
            </button>
            <button
              type="button"
              className={`quick-chip${destination === 'partner' ? ' selected' : ''}`}
              aria-pressed={destination === 'partner'}
              onClick={() => setDestination('partner')}
            >
              <Icon name="handshake" className="small" />A friend or partner
            </button>
          </div>
          {destination === 'partner' ? (
            <div className="pair">
              <div className="field">
                <label htmlFor="partnerName">Their name</label>
                <input
                  id="partnerName"
                  name="partnerName"
                  type="text"
                  required
                  maxLength={60}
                  autoComplete="off"
                  value={partnerName}
                  onChange={(event) => setPartnerName(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="partnerEmail">Their email</label>
                <input
                  id="partnerEmail"
                  name="partnerEmail"
                  type="email"
                  required
                  maxLength={200}
                  autoComplete="off"
                  value={partnerEmail}
                  onChange={(event) => setPartnerEmail(event.target.value)}
                />
              </div>
            </div>
          ) : null}
          <span className="hint">
            {destination === 'partner'
              ? 'You get a link to send them. They must accept the pact; until they do, a lost stake goes to the charity pool. They never judge your proof.'
              : 'A lost stake goes to the charity pool, never to another user.'}
          </span>
        </div>

        <div className="summary-line" aria-live="polite">
          <Icon name="lock" />
          <p>
            {amount && due ? (
              <>
                PayPal holds <strong>{amount}</strong> until <strong>{due}</strong>. Meet the goal and you pay nothing.
                Miss it and the {amount} goes to{' '}
                {destination === 'partner' ? partnerName.trim() || 'your pact partner' : 'charity'}.
              </>
            ) : (
              'Choose a deadline and a stake from $1 to $500.'
            )}
          </p>
        </div>

        <SubmitButton
          pending={pending}
          pendingLabel="Writing your proof rules…"
          progressNote="The AI is writing proof rules for this goal. This takes a few seconds."
          block
        >
          Continue
        </SubmitButton>
        <p className="body-small muted" style={{ textAlign: 'center' }}>
          Nothing is held yet. Next you review the proof rules, then place the hold
          {savedAccount ? ` in one tap with ${savedAccount}` : ' with PayPal'}.
        </p>
      </form>
    </div>
  );
}
