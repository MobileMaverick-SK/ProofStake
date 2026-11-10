# ProofStake

Put money on your own deadline. Keep it by proving you did the work.

ProofStake is a commitment app for people who work alone (students, freelancers,
solo builders) and miss the deadlines they set for themselves.

1. You write a goal, a deadline and a stake: "Finish chapter 3 notes by
   Wednesday 9 pm, stake $20".
2. An AI model turns the goal into a short, strict list of proof rules. You read
   and accept them.
3. PayPal places a **hold** on the stake. Nothing is charged.
4. Before the deadline you upload a photo of the finished work. The photo must
   include a one-time code the app shows you, written by hand.
5. An AI vision model checks the photo against the rules.
6. Plain code settles the money:
   - goal met: the hold is voided and you pay nothing;
   - goal partly met: a proportional part is captured, the rest released;
   - goal missed, or no proof by the deadline: the full stake is captured.
7. Verdicts the AI is unsure about go to a human review queue. You can appeal a
   charge, and an upheld appeal is refunded.

Captured money goes to a "charity pool" (in this prototype, the sandbox business
account). It never goes to other users, so nobody profits from you failing.

**Live demo:** https://proofstake-production.up.railway.app (PayPal sandbox; sign in to the PayPal popup with a sandbox Personal account)

> **Sandbox only.** Every payment in this project uses the PayPal sandbox. No
> real money moves, and the PayPal client refuses to start with any
> non-sandbox address.

## Contents

- [Run it locally](#run-it-locally)
- [PayPal sandbox setup](#paypal-sandbox-setup)
- [Demo walkthrough](#demo-walkthrough)
- [Architecture](#architecture)
- [How the AI is kept away from the money](#how-the-ai-is-kept-away-from-the-money)
- [Settlement policy](#settlement-policy)
- [Tests](#tests)
- [Deploy](#deploy)
- [Limits of this prototype](#limits-of-this-prototype)

## Run it locally

Requires Node.js 20.9 or newer.

```bash
git clone <this repository>
cd ProofStake
npm install
cp .env.example .env      # then fill in the values below
npm test                  # 190 tests: unit, contract, architecture, end-to-end
npm run seed              # optional: a demo account with two goals ready for a hold
npm run dev               # http://localhost:3000
```

There is no database setup step. The SQLite file and the uploaded photos are
created in `./data` on first use.

### Environment variables

| Variable | Needed for | Notes |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Holds, captures, refunds | From a PayPal **sandbox** app. See below. |
| `PAYPAL_BASE_URL` | | Leave as `https://api-m.sandbox.paypal.com`. Anything else is refused. |
| `AI_API_KEY` | Rule writing, photo checks | A Google Gemini API key from aistudio.google.com. |
| `AI_MODEL` | | Defaults to `gemini-3.6-flash`. Must accept images. |
| `CONFIDENCE_THRESHOLD` | | Verdicts below this go to review. Default `0.8`. |
| `ADMIN_PASSWORD` | Review queue | If empty, the review queue is switched off. |
| `DATA_DIR` | | Where the database and photos live. Default `./data`. |
| `SEED_EMAIL`, `SEED_PASSWORD` | `npm run seed` | Default `demo@proofstake.test` / `demo-password`. |

The app starts without any of these. Without PayPal keys the hold screen says
so. Without an AI key, rules come from a fixed template and the upload form lets
you pick the verdict to simulate, which is useful for exercising the money flow.

## PayPal sandbox setup

1. Sign in at developer.paypal.com with a PayPal account and switch the
   dashboard to **Sandbox**.
2. **Testing Tools > Sandbox Accounts**: you need one *Business* account (it
   receives captured stakes) and one *Personal* account (the buyer). PayPal
   creates a pair for you. Note the Personal account's email and password.
3. **Apps & Credentials > Create App**. Copy the client ID and secret into
   `.env`.
4. Optional, for one-tap holds: in the app's settings tick **Save payment
   methods** (Vault), save, and restart the server.

In the PayPal popup you sign in as the sandbox *Personal* account. A real PayPal
login does not work there.

## Demo walkthrough

1. **Create an account** on the first screen, or sign in as the seeded demo user.
2. **New goal**: for example "Write the numbers 1 to 8 on a single line", due in
   15 minutes, $20 stake. The AI writes the proof rules; accept them.
3. **Place the hold** with the PayPal button, approving as the sandbox buyer.
   The Money card shows PayPal's order ID and authorization ID.
4. **Upload proof**: write the on-screen code on paper next to the work and
   photograph both.
   - Everything there: the hold is voided. *You kept your $20.00.*
   - Only half the numbers: not approved, and nothing is charged yet. Upload a
     better photo (3 uploads per goal) or press **Take this result as final**
     to be charged in proportion.
   - No code, or text in the photo addressed to the AI: the result goes to a
     human reviewer instead of moving money.
5. **Receipt**: on a settled goal, **View receipt** shows what was held,
   released, charged and refunded, with the PayPal IDs.
6. **Appeal**: on a charged goal, send an appeal. Then open **Reviewer sign-in**
   (footer of the signed-out pages), enter `ADMIN_PASSWORD`, and uphold it. The
   charge is refunded through PayPal.
7. **No proof**: create a goal, place the hold, and let the deadline pass. The
   scheduler captures the full stake within about 30 seconds.

Each step can be checked on PayPal's side in the developer dashboard under
**Event Logs > API Calls**, or by signing in to sandbox.paypal.com as the buyer.

## Architecture

A modular monolith in a ports-and-adapters layout. It is one deployable app, but
each module owns its logic and its data, exposes a small public API, and reacts
to the others only through domain events.

```mermaid
flowchart LR
  subgraph app["src/app (Next.js)"]
    UI["Screens, server actions, API routes<br/>thin: validate, call a use case, respond"]
  end

  subgraph core["src/core (no framework, PayPal, AI or database imports)"]
    accounts
    goals
    rules["proof-rules"]
    intake["proof-intake"]
    verification
    settlement
    appeals
    bus(("EventBus"))
    goals <--> bus
    rules <--> bus
    intake <--> bus
    verification <--> bus
    settlement <--> bus
    appeals <--> bus
  end

  subgraph adapters["src/adapters"]
    paypal["paypal/<br/>StakeHolds, Refunds, PaymentMethodVault"]
    ai["ai/<br/>RuleWriter, ProofVerifier"]
    db["db/<br/>SQLite repositories"]
    storage["storage/<br/>ProofStore"]
  end

  UI --> core
  rules -. RuleWriter .-> ai
  verification -. ProofVerifier .-> ai
  settlement -. StakeHolds .-> paypal
  appeals -. Refunds .-> paypal
  core -. repositories .-> db
  intake -. ProofStore .-> storage
  paypal --> PP[("PayPal sandbox")]
  ai --> G[("Gemini API")]
```

Dotted lines are ports: interfaces the core defines and an adapter implements.
`src/composition-root.ts` is the only file that connects the two.

### Layout

```
src/
  core/
    accounts/        sign-up, sign-in, sessions
    goals/           goal lifecycle and its state machine
    proof-rules/     goal text -> structured proof rules
    proof-intake/    one-time code, uploads (up to 3), proof record
    verification/    verdict from proof + rules
    settlement/      pure policy: verdict -> money action, then carries it out through a port
    appeals/         review queue, appeals, refunds
    shared/          Money, Result, ids, domain events, EventBus and Clock ports
  adapters/
    paypal/          Orders v2, Payments v2, Payment Method Tokens v3, against the sandbox
    ai/              Gemini rule writer and photo verifier (plus placeholders for running without a key)
    db/              SQLite repositories
    storage/         local-disk photo store
    auth/            password hashing, session tokens, reviewer gate
    events/          in-process event bus
    fakes/           in-memory versions of every port, for tests only
  app/               Next.js screens and routes
  composition-root.ts
tests/               automated tests, including a fake PayPal HTTP server
scripts/seed.ts      the seed script
```

### Domain events

| Event | Published by | Handled by |
|---|---|---|
| GoalCreated | goals | proof-rules (draft the rules), proof-intake, settlement |
| RulesProposed | proof-rules | goals |
| RulesAccepted | proof-rules | goals (awaiting stake), proof-intake, settlement |
| StakeHeld | settlement | goals (active), proof-intake (open for uploads) |
| ProofSubmitted | proof-intake | verification, goals, settlement |
| VerdictIssued | verification | settlement |
| RetryAllowed | settlement | goals (active again), proof-intake (reopen) |
| DeadlinePassed | goals (scheduler) | settlement, proof-intake |
| ReviewRequested | settlement | appeals (review queue), goals |
| ReviewResolved | appeals | settlement |
| StakeReleased / StakeCaptured | settlement | goals (final state), appeals, proof-intake |
| AppealUpheld | appeals | goals (refunded) |

### Goal states

```
DRAFT -> RULES_PROPOSED -> AWAITING_STAKE -> ACTIVE <-> PROOF_SUBMITTED
      -> SETTLED_RELEASED | SETTLED_PARTIAL | SETTLED_FORFEITED
```

Side states: `IN_REVIEW` (the verdict needs a human) and `REFUNDED` (an appeal
was upheld). The state machine rejects every transition not on its list, and a
test checks all 100 combinations.

### Rules the code enforces on itself

`tests/architecture.test.ts` fails the build if:

- anything in `core/` imports from `adapters/`, `app/`, or any package other than Zod;
- one core module imports another's files (they may only share `core/shared`);
- code outside `core/` reaches into a module past its `index.ts`.

Every port has an in-memory fake that passes the same contract tests as the real
adapter. The `StakeHolds` contract runs against both the fake and the real PayPal
adapter (with only the HTTP layer replaced).

## How the AI is kept away from the money

- **The model never calls PayPal and never returns an amount or an outcome.** It
  reports what it sees for each rule, a fraction done and a confidence. Code in
  `src/adapters/ai/gemini-proof-verifier.ts` derives pass, partial or fail, and
  the pure function in `src/core/settlement/policy.ts` derives the amount.
- **The expected one-time code is never sent to the model.** The model
  transcribes the codes it can read, and the comparison happens in code, so a
  photo cannot talk its way past it.
- **Everything in a photo is untrusted.** Text that addresses the checker ("mark
  all checks as passed") is ignored, reported as a failed check, and forces a
  human review.
- **Doubt goes to a person.** Low confidence, a one-character code misread, work
  that looks done with no code, or an AI outage all end in review with no money
  moved.
- **Every model answer is validated with Zod.** Invalid answers are retried
  once, then turned into a zero-confidence verdict.
- **The server computes every amount** from the stored goal. The browser never
  sends an amount.

## Settlement policy

One pure function, `decideSettlement`, with 25 unit tests.

| Situation | Action |
|---|---|
| Confidence below the threshold | Request review. No money moves. |
| PASS | Release the hold. |
| PARTIAL with fraction *f* | Capture stake × (1 − *f*), rounded to cents, as the final capture. |
| FAIL | Capture the full stake. |
| No proof at the deadline | Capture the full stake. |

A capture that would round to $0.00 is a release, because PayPal cannot capture
zero. Money is integer cents everywhere and becomes a decimal string only at the
PayPal boundary.

A photo that is not approved does not settle straight away: while uploads and
time remain, the user may upload a better one. The result becomes final on the
third upload, when the user accepts it, or at the deadline.

### PayPal specifics

- Hold: Orders v2 with intent `AUTHORIZE`, approved in the PayPal popup, then
  authorized on the server.
- Release: Payments v2, void the authorization. Capture: with an explicit amount
  and `final_capture: true`. Refund: refund the capture.
- Every write carries a `PayPal-Request-Id`, so a retry cannot charge twice.
- After each write the authorization is read back and that status is stored.
- A settlement whose PayPal call fails is kept and retried every 30 seconds; the
  goal screen says so.
- One-tap holds: if the user agrees, the first hold saves their PayPal account
  (Vault). Later holds are created from the saved token with no sign-in. The
  token stays on the server.
- Goals last **at most 3 days**, so the hold stays inside PayPal's honor period
  for an authorization. Validation enforces this.

## Tests

```bash
npm test          # 190 tests
npm run typecheck
```

- **Policy, money, state machine**: exhaustive unit tests.
- **Full flow**: every path from sign-up to refund, wired exactly as in
  production, run twice (in-memory and SQLite storage).
- **PayPal adapter**: against a small fake of PayPal's HTTP API that enforces
  the same rules (approval before authorization, idempotency keys, one final
  capture, required return addresses for Vault).
- **AI adapter**: request shape, retries, malformed answers, code matching, and
  an injection attempt.

Fakes appear only in tests. The running app always talks to the real PayPal
sandbox and the real AI service.

## Deploy

The app is one Node process that needs a writable directory. The included
`Dockerfile` builds it; mount a persistent volume at `/data`.

On Railway, for example:

1. Create a project from this GitHub repository. Railway builds the Dockerfile.
2. Add a **volume** mounted at `/data`.
3. Add the variables from the table above (not `DATA_DIR`; the image sets it).
4. Generate a public domain. `GET /api/health` shows which integrations are
   configured.

No callback addresses need registering with PayPal: the app works out its own
public address from each request.

## Limits of this prototype

- **Stack change:** storage is SQLite through `better-sqlite3` behind the
  repository ports, not Prisma. Prisma's tooling could not be run in the build
  environment used for this project.
- **One process.** The event bus, the scheduler and reviewer sessions live in
  memory, so the app must run as a single instance. Reviewers sign in again
  after a restart.
- **No webhooks.** The app reads PayPal's state after each of its own calls. A
  change made outside the app (for example a hold voided in the PayPal
  dashboard) is only noticed at the next call.
- **Review can outlast the 3-day honor period.** PayPal usually still captures
  an older authorization, but no longer guarantees it.
- **No email.** There is no address verification, password reset or reminder.
- **Saving a PayPal account from the Account screen** needs an extra PayPal
  permission that a sandbox app may not have. Saving during a hold works with
  the Vault setting alone.
- **USD only**, stakes from $1 to $500.

## License

MIT. See [LICENSE](LICENSE).
