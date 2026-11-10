'use client';

import { useEffect, useState } from 'react';

function useNow(intervalMs: number): number | null {
  // null until mounted, so the server and the first client render agree.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${hours}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

/** Live time left until the deadline. Shows `doneLabel` once it has passed. */
export function Countdown({ deadline, doneLabel = 'Time is up' }: { deadline: string; doneLabel?: string }) {
  const now = useNow(1000);
  if (now === null) return <span aria-hidden="true">&nbsp;</span>;
  const remaining = new Date(deadline).getTime() - now;
  return <span>{remaining > 0 ? formatRemaining(remaining) : doneLabel}</span>;
}

/** A ring that empties as the deadline approaches. `children` sit in the middle. */
export function TimeRing({
  start,
  deadline,
  small = false,
  children,
}: {
  start: string;
  deadline: string;
  small?: boolean;
  children?: React.ReactNode;
}) {
  const now = useNow(1000);
  const from = new Date(start).getTime();
  const to = new Date(deadline).getTime();
  const left = now === null ? 1 : Math.min(1, Math.max(0, (to - now) / Math.max(1, to - from)));
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className={`ring${small ? ' small' : ''}`} role="img" aria-label={`${Math.round(left * 100)}% of the time is left`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="track" cx="50" cy="50" r={radius} />
        <circle
          className="value"
          cx="50"
          cy="50"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - left)}
        />
      </svg>
      <div className="center">{children}</div>
    </div>
  );
}

/** A moment shown in the viewer's own time zone (the server does not know it). */
export function LocalTime({ iso }: { iso: string }) {
  const now = useNow(60_000);
  if (now === null) return <span aria-hidden="true">&nbsp;</span>;
  return (
    <time dateTime={iso}>
      {new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
    </time>
  );
}
