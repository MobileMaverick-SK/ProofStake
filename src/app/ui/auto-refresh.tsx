'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-reads the screen from the server every few seconds, for moments when something is about to change. */
export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}

/** Re-reads the screen once, shortly after the given moment (for example a deadline). */
export function RefreshAt({ iso, delayMs = 2000 }: { iso: string; delayMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const wait = new Date(iso).getTime() + delayMs - Date.now();
    if (wait <= 0 || wait > 2 ** 31 - 1) return;
    const timer = setTimeout(() => router.refresh(), wait);
    return () => clearTimeout(timer);
  }, [router, iso, delayMs]);
  return null;
}
