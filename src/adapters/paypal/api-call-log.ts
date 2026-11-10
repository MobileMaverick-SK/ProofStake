/**
 * A record of every call the app makes to PayPal, so a goal's screen can show
 * exactly which APIs were called and what PayPal answered. Only safe fields are
 * kept: the method, the path, the status, timings, PayPal's ids and status words.
 * Never tokens, credentials, request bodies or payer details.
 */
export interface ApiCall {
  at: Date;
  method: 'GET' | 'POST';
  /** e.g. /v2/payments/authorizations/8AB.../capture */
  path: string;
  status: number;
  ms: number;
  /** the PayPal-Request-Id sent with a write, which makes retries safe */
  requestId?: string;
  /** PayPal's id for this request, for their support; set on errors */
  debugId?: string;
  /** what PayPal said, in its own words: "COMPLETED", "VOIDED", "PENDING", or an error name */
  result?: string;
  /** amount in PayPal's answer, if there was one, e.g. "20.00 USD" */
  amount?: string;
  /** every PayPal id and goal id this call is about, used to find it again */
  resources: string[];
}

export interface ApiCallLog {
  record(call: ApiCall): Promise<void>;
  /** Calls about any of these ids, oldest first. */
  forResources(ids: string[], limit?: number): Promise<ApiCall[]>;
}

export class InMemoryApiCallLog implements ApiCallLog {
  readonly calls: ApiCall[] = [];
  async record(call: ApiCall) {
    this.calls.push(call);
  }
  async forResources(ids: string[], limit = 100) {
    const wanted = new Set(ids.filter(Boolean));
    return this.calls.filter((call) => call.resources.some((id) => wanted.has(id))).slice(-limit);
  }
}

const PAYPAL_ID = /^[A-Z0-9][A-Z0-9-]{4,}$/;
const GOAL_ID = /goal_[0-9a-f-]{36}/g;

/** Collects the ids a PayPal call is about, from its path, request and answer. */
export function resourcesOf(path: string, requestId: string | undefined, body: string | undefined, answer: unknown): string[] {
  const found = new Set<string>();
  for (const segment of path.split('/')) {
    const decoded = decodeURIComponent(segment);
    if (PAYPAL_ID.test(decoded)) found.add(decoded);
  }
  for (const text of [requestId ?? '', body ?? '']) for (const match of text.match(GOAL_ID) ?? []) found.add(match);
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 6) return;
    if (Array.isArray(value)) return value.forEach((item) => visit(item, depth + 1));
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((key === 'id' || key === 'payout_batch_id' || key === 'payout_item_id' || key === 'reference_id' || key === 'custom_id') && typeof child === 'string') {
        if (PAYPAL_ID.test(child) || GOAL_ID.test(child)) found.add(child);
        GOAL_ID.lastIndex = 0;
      } else if (key !== 'links' && key !== 'payer' && key !== 'payment_source') {
        visit(child, depth + 1);
      }
    }
  };
  visit(answer, 0);
  return [...found];
}

/** The status word and amount PayPal gave, looking where each API puts them. */
export function summaryOf(answer: unknown): { result?: string; amount?: string } {
  if (!answer || typeof answer !== 'object') return {};
  const body = answer as Record<string, any>;
  const authorization = body.purchase_units?.[0]?.payments?.authorizations?.[0];
  const result =
    authorization?.status ??
    body.status ??
    body.batch_header?.batch_status ??
    body.items?.[0]?.transaction_status ??
    body.verification_status ??
    body.name;
  const money = authorization?.amount ?? body.amount ?? body.purchase_units?.[0]?.amount;
  const value = money?.value;
  const currency = money?.currency_code ?? money?.currency;
  return {
    result: typeof result === 'string' ? result : undefined,
    amount: typeof value === 'string' && typeof currency === 'string' ? `${value} ${currency}` : undefined,
  };
}
