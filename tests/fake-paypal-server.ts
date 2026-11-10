/**
 * A tiny in-memory imitation of the PayPal sandbox REST API, exposed as a
 * `fetch` function. Tests only: the running app always uses the real fetch.
 */
interface Order {
  id: string;
  body: {
    purchase_units: { amount: { currency_code: string; value: string } }[];
    payment_source?: { paypal?: { vault_id?: string; attributes?: { vault?: object } } };
  };
  vaultId?: string;
  approved: boolean;
  authorizationId?: string;
}
interface Authorization {
  id: string;
  status: string;
  amount: { currency_code: string; value: string };
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export function createFakePayPalServer() {
  const orders = new Map<string, Order>();
  const authorizations = new Map<string, Authorization>();
  const byRequestId = new Map<string, { status: number; body: unknown }>();
  const requests: RecordedRequest[] = [];
  let sequence = 0;
  let tokensIssued = 0;
  let validToken = '';
  const vaultIds = new Set<string>();
  const setups = new Map<string, boolean>();
  const options = { vaultingEnabled: true, payoutItemStatus: 'SUCCESS' };
  const payouts = new Map<string, { receiver: string; value: string }>();

  const json = (status: number, body: unknown) =>
    new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const unprocessable = (issue: string) =>
    json(422, { name: 'UNPROCESSABLE_ENTITY', debug_id: 'fake-debug-id', details: [{ issue, description: issue }] });
  const orderView = (order: Order) => {
    const auth = order.authorizationId ? authorizations.get(order.authorizationId) : undefined;
    return {
      id: order.id,
      status: auth ? 'COMPLETED' : order.approved ? 'APPROVED' : 'PAYER_ACTION_REQUIRED',
      links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${order.id}`, method: 'GET' }],
      purchase_units: [{ payments: auth ? { authorizations: [auth] } : undefined }],
      payment_source: order.vaultId
        ? { paypal: { email_address: 'buyer@example.test', attributes: { vault: { id: order.vaultId, status: 'VAULTED' } } } }
        : { paypal: {} },
    };
  };

  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const body = typeof init?.body === 'string' && headers['Content-Type'] === 'application/json' ? JSON.parse(init.body) : init?.body;
    requests.push({ method, path: url.pathname, headers, body });

    if (url.pathname === '/v1/oauth2/token') {
      const expected = `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`;
      if (headers.Authorization !== expected) return json(401, { error: 'invalid_client' });
      validToken = `token-${++tokensIssued}`;
      return json(200, { access_token: validToken, token_type: 'Bearer', expires_in: 3600 });
    }
    if (headers.Authorization !== `Bearer ${validToken}`) return json(401, { name: 'AUTHENTICATION_FAILURE' });

    const requestId = headers['PayPal-Request-Id'];
    if (method === 'POST' && requestId && byRequestId.has(requestId)) {
      const replay = byRequestId.get(requestId)!;
      return json(replay.status, replay.body);
    }
    const remember = (status: number, responseBody: unknown) => {
      if (requestId) byRequestId.set(requestId, { status, body: responseBody });
      return json(status, responseBody);
    };

    let match: RegExpExecArray | null;
    if (method === 'POST' && url.pathname === '/v2/checkout/orders') {
      const order: Order = { id: `ORDER${++sequence}`, body: body as Order['body'], approved: false };
      const wallet = order.body.payment_source?.paypal;
      if (wallet?.attributes?.vault && !options.vaultingEnabled) return unprocessable('PAYPAL_VAULTING_NOT_ENABLED');
      if (wallet?.attributes?.vault && !(wallet as { experience_context?: { return_url?: string } }).experience_context?.return_url) {
        return unprocessable('RETURN_URL_REQUIRED');
      }
      if (wallet?.vault_id) {
        // Paying with a saved account: no buyer step, the order comes back already authorized.
        if (!vaultIds.has(wallet.vault_id)) return unprocessable('INVALID_VAULT_ID');
        const auth: Authorization = { id: `AUTH${++sequence}`, status: 'CREATED', amount: order.body.purchase_units[0]!.amount };
        authorizations.set(auth.id, auth);
        order.approved = true;
        order.authorizationId = auth.id;
      }
      orders.set(order.id, order);
      return remember(201, orderView(order));
    }
    if ((match = /^\/v2\/checkout\/orders\/([^/]+)(\/authorize)?$/.exec(url.pathname))) {
      const order = orders.get(match[1]!);
      if (!order) return json(404, { name: 'RESOURCE_NOT_FOUND' });
      if (method === 'GET') return json(200, orderView(order));
      if (!order.approved) return unprocessable('ORDER_NOT_APPROVED');
      if (order.authorizationId) return unprocessable('ORDER_ALREADY_AUTHORIZED');
      const auth: Authorization = { id: `AUTH${++sequence}`, status: 'CREATED', amount: order.body.purchase_units[0]!.amount };
      authorizations.set(auth.id, auth);
      order.authorizationId = auth.id;
      if (order.body.payment_source?.paypal?.attributes?.vault) {
        order.vaultId = `VAULT${++sequence}`;
        vaultIds.add(order.vaultId);
      }
      return remember(201, orderView(order));
    }
    if ((match = /^\/v2\/payments\/authorizations\/([^/]+)(?:\/(void|capture))?$/.exec(url.pathname))) {
      const auth = authorizations.get(match[1]!);
      if (!auth) return json(404, { name: 'RESOURCE_NOT_FOUND' });
      if (method === 'GET') return json(200, auth);
      if (match[2] === 'void') {
        if (auth.status === 'VOIDED') return unprocessable('PREVIOUSLY_VOIDED');
        if (auth.status !== 'CREATED') return unprocessable('PREVIOUSLY_CAPTURED');
        auth.status = 'VOIDED';
        return remember(204, null);
      }
      const capture = body as { amount: { value: string }; final_capture: boolean };
      if (auth.status === 'VOIDED') return unprocessable('AUTHORIZATION_VOIDED');
      if (auth.status !== 'CREATED') return unprocessable('AUTHORIZATION_ALREADY_CAPTURED');
      if (Number(capture.amount.value) > Number(auth.amount.value)) return unprocessable('MAX_CAPTURE_AMOUNT_EXCEEDED');
      auth.status = capture.amount.value === auth.amount.value ? 'CAPTURED' : 'PARTIALLY_CAPTURED';
      return remember(201, { id: `CAPTURE${++sequence}`, status: 'COMPLETED', amount: capture.amount });
    }
    if ((match = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(url.pathname)) && method === 'POST') {
      return remember(201, { id: `REFUND${++sequence}`, status: 'COMPLETED' });
    }
    if (method === 'POST' && url.pathname === '/v1/payments/payouts') {
      const payout = body as { sender_batch_header?: { sender_batch_id?: string }; items?: { receiver?: string; amount?: { value?: string } }[] };
      const item = payout.items?.[0];
      if (!payout.sender_batch_header?.sender_batch_id || !item?.receiver || !item.amount?.value) return unprocessable('VALIDATION_ERROR');
      const id = `PAYOUT${++sequence}`;
      payouts.set(id, { receiver: item.receiver, value: item.amount.value });
      return remember(201, { batch_header: { payout_batch_id: id, batch_status: 'PENDING' } });
    }
    if ((match = /^\/v1\/payments\/payouts\/([^/]+)$/.exec(url.pathname)) && method === 'GET') {
      if (!payouts.has(match[1]!)) return json(404, { name: 'RESOURCE_NOT_FOUND' });
      return json(200, { batch_header: { payout_batch_id: match[1], batch_status: 'SUCCESS' }, items: [{ transaction_status: options.payoutItemStatus }] });
    }
    if (method === 'POST' && url.pathname === '/v3/vault/setup-tokens') {
      const wallet = (body as { payment_source?: { paypal?: { experience_context?: { return_url?: string; cancel_url?: string } } } })
        .payment_source?.paypal;
      if (!wallet?.experience_context?.return_url || !wallet.experience_context.cancel_url) return unprocessable('RETURN_URL_REQUIRED');
      const id = `SETUP${++sequence}`;
      setups.set(id, false);
      return remember(201, {
        id,
        status: 'PAYER_ACTION_REQUIRED',
        links: [{ rel: 'approve', href: `https://www.sandbox.paypal.com/agreements/approve?approval_session_id=${id}`, method: 'GET' }],
      });
    }
    if (method === 'POST' && url.pathname === '/v3/vault/payment-tokens') {
      const setupId = (body as { payment_source?: { token?: { id?: string; type?: string } } }).payment_source?.token;
      if (setupId?.type !== 'SETUP_TOKEN' || !setupId.id || !setups.has(setupId.id)) return json(404, { name: 'RESOURCE_NOT_FOUND' });
      if (!setups.get(setupId.id)) return unprocessable('SETUP_TOKEN_NOT_APPROVED');
      const vaultId = `VAULT${++sequence}`;
      vaultIds.add(vaultId);
      return remember(201, { id: vaultId, customer: { id: 'CUST1' }, payment_source: { paypal: { email_address: 'buyer@example.test' } } });
    }
    return json(404, { name: 'RESOURCE_NOT_FOUND' });
  };

  return {
    fetchFn,
    requests,
    options,
    vaultIds,
    tokensIssued: () => tokensIssued,
    /** Plays the buyer approving the order in the PayPal popup. */
    approve(orderId: string) {
      orders.get(orderId)!.approved = true;
    },
    /** Makes the current access token invalid, as if PayPal had revoked it. */
    revokeToken() {
      validToken = 'revoked';
    },
    /** Plays the buyer approving "save my account" on the PayPal page. */
    approveSetup(setupId: string) {
      setups.set(setupId, true);
    },
    forgetIdempotency() {
      byRequestId.clear();
    },
  };
}
