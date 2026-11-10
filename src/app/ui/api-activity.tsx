import type { ApiCall } from '@/adapters/paypal';
import { Icon } from './symbol';
import { LocalTime } from './time';

/** What each PayPal endpoint the app uses is for, in plain words. */
const PURPOSE: [RegExp, string][] = [
  [/^POST \/v2\/checkout\/orders$/, 'Create the order for the hold'],
  [/^POST \/v2\/checkout\/orders\/[^/]+\/authorize$/, 'Authorize: place the hold'],
  [/^GET \/v2\/checkout\/orders\/[^/]+$/, 'Read the order back'],
  [/^POST \/v2\/payments\/authorizations\/[^/]+\/void$/, 'Void: release the hold'],
  [/^POST \/v2\/payments\/authorizations\/[^/]+\/capture$/, 'Capture: charge the stake'],
  [/^GET \/v2\/payments\/authorizations\/[^/]+$/, 'Read the hold status'],
  [/^POST \/v2\/payments\/captures\/[^/]+\/refund$/, 'Refund the charge'],
  [/^POST \/v1\/payments\/payouts$/, 'Payout to the pact partner'],
  [/^GET \/v1\/payments\/payouts\/[^/]+$/, 'Read the payout status'],
  [/^POST \/v3\/vault\/setup-tokens$/, 'Start saving a PayPal account'],
  [/^POST \/v3\/vault\/payment-tokens$/, 'Save the PayPal account'],
  [/^POST \/v1\/notifications\/verify-webhook-signature$/, 'Verify a webhook signature'],
];

const purposeOf = (call: ApiCall) => PURPOSE.find(([pattern]) => pattern.test(`${call.method} ${call.path}`))?.[1] ?? 'PayPal API call';

/**
 * Every call this app made to PayPal for one goal, with PayPal's own answer: the
 * real endpoints, status codes, ids and statuses, so nobody has to open the
 * PayPal dashboard to see what happened.
 */
export function ApiActivity({ calls, open = true }: { calls: ApiCall[]; open?: boolean }) {
  if (calls.length === 0) return null;
  return (
    <section className="card outlined stack">
      <details className="api-activity" open={open}>
        <summary className="row spread">
          <span className="title row">
            <Icon name="api" />
            PayPal API calls
          </span>
          <span className="chip">{calls.length}</span>
        </summary>
        <ol className="api-calls">
          {calls.map((call, index) => {
            const ok = call.status >= 200 && call.status < 300;
            return (
              <li key={index}>
                <p className="body-small strong">{purposeOf(call)}</p>
                <p className="api-line">
                  <span className="api-method">{call.method}</span>
                  <span className="api-path">{call.path}</span>
                </p>
                <p className="api-meta">
                  <span className={`api-status ${ok ? 'ok' : 'bad'}`}>{call.status}</span>
                  {call.result ? <span className="api-result">{call.result}</span> : null}
                  {call.amount ? <span>{call.amount}</span> : null}
                  <span className="muted">{call.ms} ms</span>
                  <span className="muted">
                    <LocalTime iso={new Date(call.at).toISOString()} />
                  </span>
                </p>
                {call.requestId ? <p className="api-extra muted">PayPal-Request-Id {call.requestId}</p> : null}
                {call.debugId ? <p className="api-extra muted">debug_id {call.debugId}</p> : null}
              </li>
            );
          })}
        </ol>
        <p className="body-small muted">
          Recorded by the server as each call was made. The same calls appear in the PayPal developer dashboard under
          Event Logs.
        </p>
      </details>
    </section>
  );
}
