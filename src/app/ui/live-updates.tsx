'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Keeps a screen current without the user refreshing it. It asks the server for
 * a fingerprint of what the screen shows and re-reads the screen only when that
 * changes. The server also says when to ask again: every 5 seconds while
 * something is about to happen (a proof check, a payment step, a payout due),
 * every 10 seconds otherwise, and not at all once nothing can change. It pauses
 * in background tabs and catches up when the user comes back.
 */
export function LiveUpdates({ url, version, nextCheckMs }: { url: string; version: string; nextCheckMs: number | null }) {
  const router = useRouter();
  const last = useRef(version);
  const [online, setOnline] = useState(true);
  const [watching, setWatching] = useState(nextCheckMs !== null);

  useEffect(() => {
    last.current = version;
    setWatching(nextCheckMs !== null);
    if (nextCheckMs === null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = nextCheckMs;

    const schedule = () => {
      if (!stopped) timer = setTimeout(check, delay);
    };
    async function check() {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const pulse = (await response.json()) as { version: string; nextCheckMs: number | null };
        setOnline(true);
        if (pulse.version !== last.current) {
          last.current = pulse.version;
          // The new screen brings its own timing with it.
          router.refresh();
          return;
        }
        if (pulse.nextCheckMs === null) {
          setWatching(false);
          return;
        }
        delay = pulse.nextCheckMs;
      } catch {
        setOnline(false);
        delay = Math.min(delay * 2, 60_000);
      }
      schedule();
    }
    function onVisible() {
      if (document.visibilityState !== 'visible' || stopped) return;
      clearTimeout(timer);
      void check();
    }

    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router, url, version, nextCheckMs]);

  if (!watching) return null;
  return (
    <span className={`live${online ? '' : ' off'}`} role="status">
      <span className="dot" aria-hidden="true" />
      {online ? 'Live' : 'Reconnecting…'}
    </span>
  );
}
