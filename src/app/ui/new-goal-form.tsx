'use client';

import { useState } from 'react';
import type { FormState } from '@/app/lib/form-state';
import { DeadlinePicker } from './deadline-picker';
import { SubmitButton } from './submit-button';
import { Icon } from './symbol';
import { useKeptForm } from './use-kept-form';

const QUICK_STAKES = ['5.00', '10.00', '20.00', '50.00'];
const MAX_TEXT = 500;

export function NewGoalForm({
  action,
  savedAccount,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  /** The user's saved PayPal account, if they have one: the hold will then take one tap. */
  savedAccount?: string | null;
}) {
  const { state, pending, onSubmit } = useKeptForm(action);
  const [stake, setStake] = useState('20.00');
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [destination, setDestination] = useState<'charity' | 'partner'>('charity');
  const [partnerName, setPartnerName] = useState('');

  const validStake = /^\d+(\.\d{1,2})?$/.test(stake) && Number(stake) >= 1 && Number(stake) <= 500;
  const amount = validStake ? `$${Number(stake).toFixed(2)}` : null;
  const due = deadline
    ? deadline.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null;

  return (
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
        />
        <span className="hint">Something a photo can show. Say how much: pages, items, problems.</span>
      </div>

      <div className="field">
        <span className="question" id="due-label">
          When is it due?
        </span>
        <DeadlinePicker onDeadline={setDeadline} />
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
            <Icon name="handshake" className="small" />
            A friend or partner
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
              <input id="partnerEmail" name="partnerEmail" type="email" required maxLength={200} autoComplete="off" />
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
  );
}
