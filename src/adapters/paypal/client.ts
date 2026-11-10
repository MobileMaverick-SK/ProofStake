/** The only hosts this app will ever talk to. There is no code path to live PayPal. */
const SANDBOX_HOSTS = new Set(['api-m.sandbox.paypal.com', 'api.sandbox.paypal.com']);
const REQUEST_TIMEOUT_MS = 20_000;

import { resourcesOf, summaryOf, type ApiCall } from './api-call-log';

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  /** Injected so tests can stand in for the network. The running app uses the real fetch. */
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Told about every API call (never the token request), so screens can show what PayPal was asked and said. */
  onCall?: (call: ApiCall) => void;
}

/** A non-2xx answer from PayPal. Stays on the server: it is mapped to a DomainError before it leaves the adapter. */
export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorName: string,
    readonly issues: string[],
    readonly debugId?: string,
  ) {
    super(`PayPal ${status} ${errorName}${issues.length ? ` [${issues.join(', ')}]` : ''}`);
    this.name = 'PayPalApiError';
  }

  has(issue: string): boolean {
    return this.issues.includes(issue);
  }
}

export class PayPalNotConfiguredError extends Error {
  constructor() {
    super('PayPal sandbox credentials are missing. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.');
    this.name = 'PayPalNotConfiguredError';
  }
}

interface RequestOptions {
  body?: unknown;
  /** A body that is already JSON text and must be sent byte for byte. Used instead of `body`. */
  rawBody?: string;
  /** Sent as PayPal-Request-Id so a retried write is not applied twice. */
  requestId?: string;
}

export class PayPalClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: PayPalConfig) {
    const url = new URL(config.baseUrl);
    if (url.protocol !== 'https:' || !SANDBOX_HOSTS.has(url.hostname)) {
      throw new Error(`Refusing to use ${config.baseUrl}: ProofStake only talks to the PayPal sandbox.`);
    }
    this.baseUrl = url.origin;
    this.fetchFn = config.fetchFn ?? fetch;
    this.now = config.now ?? Date.now;
  }

  get configured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  async get(path: string): Promise<unknown> {
    return this.request('GET', path, {});
  }

  async post(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.request('POST', path, options);
  }

  private async request(method: 'GET' | 'POST', path: string, options: RequestOptions, retried = false): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      'Content-Type': 'application/json',
      // Ask for the full resource back, so we store what PayPal says rather than what we assume.
      Prefer: 'return=representation',
    };
    if (options.requestId) headers['PayPal-Request-Id'] = options.requestId;

    const body = method === 'POST' ? (options.rawBody ?? JSON.stringify(options.body ?? {})) : undefined;
    const started = Date.now();
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 401 && !retried) {
      this.token = null; // the cached token was revoked or expired early: fetch a new one, once
      return this.request(method, path, options, true);
    }
    const payload = await readJson(response);
    this.report(method, path, options.requestId, body, response.status, Date.now() - started, payload);
    if (!response.ok) throw toApiError(response.status, payload);
    return payload;
  }

  private report(
    method: 'GET' | 'POST',
    path: string,
    requestId: string | undefined,
    body: string | undefined,
    status: number,
    ms: number,
    payload: unknown,
  ): void {
    if (!this.config.onCall) return;
    try {
      const debugId = (payload as { debug_id?: unknown } | null)?.debug_id;
      this.config.onCall({
        at: new Date(),
        method,
        path: path.split('?')[0]!,
        status,
        ms,
        requestId,
        debugId: typeof debugId === 'string' ? debugId : undefined,
        ...summaryOf(payload),
        resources: resourcesOf(path, requestId, body, payload),
      });
    } catch {
      // A record that cannot be made must never break a payment.
    }
  }

  /** Client-credentials token, cached until shortly before it expires. */
  private async accessToken(): Promise<string> {
    if (!this.configured) throw new PayPalNotConfiguredError();
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;

    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const response = await this.fetchFn(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = (await readJson(response)) as { access_token?: unknown; expires_in?: unknown } | null;
    if (!response.ok || typeof payload?.access_token !== 'string') throw toApiError(response.status, payload);

    const lifetimeSeconds = typeof payload.expires_in === 'number' ? payload.expires_in : 300;
    this.token = { value: payload.access_token, expiresAt: this.now() + (lifetimeSeconds - 60) * 1000 };
    return this.token.value;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toApiError(status: number, payload: unknown): PayPalApiError {
  const body = (payload ?? {}) as { name?: unknown; error?: unknown; debug_id?: unknown; details?: unknown };
  const name = typeof body.name === 'string' ? body.name : typeof body.error === 'string' ? body.error : 'UNKNOWN_ERROR';
  const issues = Array.isArray(body.details)
    ? body.details.map((d) => (d as { issue?: unknown }).issue).filter((i): i is string => typeof i === 'string')
    : [];
  return new PayPalApiError(status, name, issues, typeof body.debug_id === 'string' ? body.debug_id : undefined);
}
