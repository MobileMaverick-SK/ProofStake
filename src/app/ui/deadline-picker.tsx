'use client';

import { useEffect, useState } from 'react';

const PRESETS = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 24 * 60, label: '1 day' },
  { minutes: 3 * 24 * 60, label: '3 days' },
];
const MAX_MS = 3 * 24 * 60 * 60 * 1000;

/** "2026-11-12T21:00" in the viewer's own time zone, the format datetime-local inputs use. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Quick presets, or an exact date and time. A preset posts `minutes`; an exact
 * time posts `deadlineIso`, converted here because only the browser knows the
 * user's time zone. The server checks the 3-day limit again either way.
 * `onDeadline` reports the chosen moment so the form can show it back.
 */
export function DeadlinePicker({ onDeadline }: { onDeadline?: (deadline: Date | null) => void }) {
  // Controlled, so the choice survives anything that resets the form.
  const [choice, setChoice] = useState<string>(String(24 * 60));
  const custom = choice === 'custom';
  const [value, setValue] = useState('');
  const [limits, setLimits] = useState<{ min: string; max: string } | null>(null);

  function chooseCustom() {
    const now = Date.now();
    setLimits({ min: toLocalInput(new Date(now + 5 * 60_000)), max: toLocalInput(new Date(now + MAX_MS)) });
    if (!value) setValue(toLocalInput(new Date(now + 24 * 60 * 60_000)));
    setChoice('custom');
  }

  const exact = custom && value && !Number.isNaN(new Date(value).getTime()) ? new Date(value) : null;
  const iso = exact ? exact.toISOString() : '';

  useEffect(() => {
    if (!onDeadline) return;
    onDeadline(custom ? exact : new Date(Date.now() + Number(choice) * 60_000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, value]);

  return (
    <div className="stack">
      <div className="choices" role="radiogroup" aria-labelledby="due-label">
        {PRESETS.map((option) => (
          <label className="choice" key={option.minutes}>
            <input
              type="radio"
              name="minutes"
              value={option.minutes}
              checked={choice === String(option.minutes)}
              onChange={() => setChoice(String(option.minutes))}
            />
            <span>in {option.label}</span>
          </label>
        ))}
        <label className="choice">
          <input type="radio" name="minutes" value="custom" checked={custom} onChange={chooseCustom} />
          <span>Exact time</span>
        </label>
      </div>
      {custom ? (
        <div className="field">
          <label htmlFor="deadline-exact" className="visually-hidden">
            Exact deadline
          </label>
          <input
            id="deadline-exact"
            type="datetime-local"
            required
            value={value}
            min={limits?.min}
            max={limits?.max}
            onChange={(event) => setValue(event.target.value)}
          />
          <span className="hint">At most 3 days from now.</span>
          <input type="hidden" name="deadlineIso" value={iso} />
        </div>
      ) : null}
    </div>
  );
}
