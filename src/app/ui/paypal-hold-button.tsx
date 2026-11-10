'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './symbol';

interface ClickActions {
  resolve(): Promise<void>;
  reject(): Promise<void>;
}
interface PayPalButtons {
  render(container: HTMLElement): Promise<void>;
  close(): Promise<void>;
}
interface PayPalSdk {
  Buttons(options: {
    style?: Record<string, string | number>;
    onClick?: (data: unknown, actions: ClickActions) => Promise<void> | void;
    createOrder: () => Promise<string>;
    onApprove: () => Promise<void>;
    onCancel?: () => void;
    onError?: (error: unknown) => void;
  }): PayPalButtons;
}
declare global {
  interface Window {
    paypal?: PayPalSdk;
  }
}

let sdkPromise: Promise<PayPalSdk> | null = null;

/** Loads the PayPal JS SDK once. intent=authorize: approving places a hold, it does not pay. */
function loadSdk(clientId: string): Promise<PayPalSdk> {
  sdkPromise ??= new Promise<PayPalSdk>((resolve, reject) => {
    const script = document.createElement('script');
    const query = new URLSearchParams({
      'client-id': clientId,
      currency: 'USD',
      intent: 'authorize',
      components: 'buttons',
      'disable-funding': 'card,credit,paylater,venmo',
    });
    script.src = `https://www.paypal.com/sdk/js?${query}`;
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error('PayPal did not load')));
    script.onerror = () => reject(new Error('PayPal did not load'));
    document.head.appendChild(script);
  }).catch((error) => {
    sdkPromise = null; // allow a retry
    throw error;
  });
  return sdkPromise;
}

async function post(url: string, body?: unknown): Promise<Record<string, string>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, string>;
  if (!response.ok) throw new Error(payload.error ?? 'Something went wrong. Try again.');
  return payload;
}

/** An order prepared ahead of the click stays usable for this long; PayPal expires unapproved orders after a few hours. */
const PREPARED_ORDER_MS = 30 * 60 * 1000;

export function PayPalHoldButton({ goalId, clientId }: { goalId: string; clientId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'opening' | 'confirming' | 'unavailable'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [save, setSave] = useState(true);
  // Values the PayPal callbacks read. Refs, because the buttons are rendered once and must see the latest values.
  const saveRef = useRef(save);
  const busy = useRef(false);
  const prepared = useRef<{ save: boolean; at: number; order: Promise<string> } | null>(null);

  /** The order for the current "save" choice, created ahead of the click so the PayPal window opens without a wait. */
  function orderFor(wantSave: boolean): Promise<string> {
    const current = prepared.current;
    if (current && current.save === wantSave && Date.now() - current.at < PREPARED_ORDER_MS) return current.order;
    const order = post(`/api/goals/${goalId}/stake`, { save: wantSave }).then((body) => body.orderId!);
    const entry = { save: wantSave, at: Date.now(), order };
    prepared.current = entry;
    order.catch(() => {
      if (prepared.current === entry) prepared.current = null; // do not keep a failed attempt
    });
    return order;
  }

  useEffect(() => {
    saveRef.current = save;
    if (phase === 'ready') void orderFor(save).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save, phase]);

  useEffect(() => {
    let cancelled = false;
    let buttons: PayPalButtons | null = null;
    setPhase('loading');

    loadSdk(clientId)
      .then(async (paypal) => {
        if (cancelled || !container.current) return;
        buttons = paypal.Buttons({
          style: { shape: 'pill', height: 48, label: 'paypal' },
          // One PayPal window at a time: a second click while the first is opening is refused.
          onClick: (_data, actions) => {
            if (busy.current) return actions.reject();
            busy.current = true;
            setMessage(null);
            setPhase('opening');
            return actions.resolve();
          },
          createOrder: () => orderFor(saveRef.current),
          onApprove: async () => {
            setPhase('confirming');
            try {
              await post(`/api/goals/${goalId}/stake/confirm`);
              router.refresh();
            } catch (error) {
              busy.current = false;
              prepared.current = null;
              setMessage(error instanceof Error ? error.message : 'The hold could not be placed.');
              setPhase('ready');
            }
          },
          onCancel: () => {
            busy.current = false;
            setMessage('You closed PayPal before approving, so no hold was placed.');
            setPhase('ready');
          },
          onError: (error) => {
            busy.current = false;
            prepared.current = null;
            setMessage(error instanceof Error && error.message ? error.message : 'PayPal could not start. Try again.');
            setPhase('ready');
          },
        });
        await buttons.render(container.current);
        if (!cancelled) setPhase('ready');
      })
      .catch(() => {
        if (!cancelled) setPhase('unavailable');
      });

    return () => {
      cancelled = true;
      busy.current = false;
      void buttons?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId, clientId, router, attempt]);

  const showButtons = phase === 'ready' || phase === 'opening';

  return (
    <div className="stack">
      {message ? (
        <div className="banner" role="alert">
          <Icon name="error" />
          <p className="body-small">{message}</p>
        </div>
      ) : null}
      {showButtons ? (
        <label className="check">
          <input type="checkbox" checked={save} disabled={phase !== 'ready'} onChange={(event) => setSave(event.target.checked)} />
          <span>
            Save this PayPal account for my next goals
            <span className="body-small muted">Later holds then take one tap, with no PayPal sign-in. You can remove it in Account.</span>
          </span>
        </label>
      ) : null}
      {phase === 'loading' ? <div className="skeleton" style={{ minHeight: 48, borderRadius: 24 }} aria-label="Loading PayPal" /> : null}
      {phase === 'confirming' ? (
        <div className="stack" role="status">
          <div className="progress" />
          <p className="body-small muted">Placing the hold with PayPal…</p>
        </div>
      ) : null}
      {phase === 'unavailable' ? (
        <div className="stack">
          <div className="banner" role="alert">
            <Icon name="cloud_off" />
            <p className="body-small">PayPal did not load. Check your connection and any ad blocker, then try again.</p>
          </div>
          <button type="button" className="button tonal" onClick={() => setAttempt((n) => n + 1)}>
            <Icon name="refresh" />
            Load PayPal again
          </button>
        </div>
      ) : null}
      {/* While a PayPal window is open the button cannot be pressed again. */}
      <div ref={container} hidden={!showButtons} className={phase === 'opening' ? 'paypal-busy' : undefined} />
      {phase === 'opening' ? (
        <p className="body-small muted row tight" role="status">
          <Icon name="open_in_new" className="small" />
          Finish in the PayPal window. If you closed it, this button comes back in a moment.
        </p>
      ) : null}
    </div>
  );
}
