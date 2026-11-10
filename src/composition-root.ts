/**
 * The only file that wires adapters into core modules.
 *
 * `createApp` takes every port explicitly, so tests can pass fakes and
 * production can pass real adapters without the core noticing.
 */
import { join } from 'node:path';
import {
  GeminiCaseAgent,
  GeminiClient,
  GeminiGoalAgent,
  GeminiProofVerifier,
  GeminiRuleWriter,
  ManualVerdictVerifier,
  TemplateRuleWriter,
} from './adapters/ai';
import { AdminGate, RandomSessionTokens, ScryptPasswordHasher } from './adapters/auth';
import { createSqliteRepositories, openDatabase } from './adapters/db';
import { InProcessEventBus } from './adapters/events/in-process-event-bus';
import {
  PayPalClient,
  PayPalMethodVault,
  PayPalPayouts,
  PayPalReadOnlyTools,
  PayPalRefunds,
  PayPalStakeHolds,
} from './adapters/paypal';
import { LocalDiskProofStore } from './adapters/storage/local-disk-proof-store';
import { systemClock } from './adapters/system-clock';
import {
  createAccountsModule,
  type PasswordHasher,
  type SessionRepository,
  type SessionTokens,
  type UserRepository,
} from './core/accounts';
import { createAppealsModule, type CaseAdvisor, type Refunds, type ReviewRepository } from './core/appeals';
import { createGoalsModule, type GoalDrafter, type GoalRepository } from './core/goals';
import { createPactsModule, type PactRepository, type Payouts } from './core/pacts';
import {
  createProofIntakeModule,
  type CodeGenerator,
  type ProofRepository,
  type ProofStore,
} from './core/proof-intake';
import { createProofRulesModule, type RuleWriter, type RulesRepository } from './core/proof-rules';
import {
  createSettlementModule,
  type PaymentMethodVault,
  type SavedMethodRepository,
  type StakeHolds,
  type StakeRepository,
} from './core/settlement';
import type { Clock, EventBus } from './core/shared';
import { createVerificationModule, type ProofVerifier, type VerdictRepository } from './core/verification';

export interface Ports {
  bus: EventBus;
  clock: Clock;
  goalRepository: GoalRepository;
  rulesRepository: RulesRepository;
  proofRepository: ProofRepository;
  verdictRepository: VerdictRepository;
  stakeRepository: StakeRepository;
  savedMethodRepository: SavedMethodRepository;
  reviewRepository: ReviewRepository;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  passwordHasher: PasswordHasher;
  sessionTokens: SessionTokens;
  ruleWriter: RuleWriter;
  proofVerifier: ProofVerifier;
  proofStore: ProofStore;
  stakeHolds: StakeHolds;
  methodVault: PaymentMethodVault;
  refunds: Refunds;
  caseAdvisor?: CaseAdvisor;
  goalDrafter?: GoalDrafter;
  pactRepository: PactRepository;
  payouts: Payouts;
  appealWindowMs?: number;
  generateCode?: CodeGenerator;
  confidenceThreshold?: number;
}

export function createApp(ports: Ports) {
  const { bus, clock } = ports;
  return {
    accounts: createAccountsModule({
      users: ports.userRepository,
      sessions: ports.sessionRepository,
      hasher: ports.passwordHasher,
      tokens: ports.sessionTokens,
      clock,
    }),
    goals: createGoalsModule({ goals: ports.goalRepository, drafter: ports.goalDrafter, bus, clock }),
    proofRules: createProofRulesModule({ rules: ports.rulesRepository, writer: ports.ruleWriter, bus }),
    proofIntake: createProofIntakeModule({
      proofs: ports.proofRepository,
      store: ports.proofStore,
      bus,
      clock,
      generateCode: ports.generateCode,
    }),
    verification: createVerificationModule({
      verifier: ports.proofVerifier,
      verdicts: ports.verdictRepository,
      bus,
    }),
    settlement: createSettlementModule({
      stakes: ports.stakeRepository,
      holds: ports.stakeHolds,
      savedMethods: ports.savedMethodRepository,
      vault: ports.methodVault,
      bus,
      clock,
      confidenceThreshold: ports.confidenceThreshold,
    }),
    // Interface segregation: appeals receives Refunds and nothing else from the payment side.
    appeals: createAppealsModule({
      reviews: ports.reviewRepository,
      refunds: ports.refunds,
      advisor: ports.caseAdvisor,
      bus,
      clock,
    }),
    // Likewise, pacts receives Payouts and nothing else.
    pacts: createPactsModule({
      pacts: ports.pactRepository,
      payouts: ports.payouts,
      bus,
      clock,
      appealWindowMs: ports.appealWindowMs,
    }),
  };
}

export type App = ReturnType<typeof createApp>;

/** Bump when the wiring changes, so a running dev server rebuilds its cached app instead of using a stale one. */
const APP_REVISION = 15;

/** How often the scheduler looks for goals whose deadline has passed. */
const DEADLINE_CHECK_MS = 30_000;

function buildRunningApp() {
  const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
  const paypalClientId = process.env.PAYPAL_CLIENT_ID ?? '';
  const paypal = new PayPalClient({
    clientId: paypalClientId,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
    baseUrl: process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com',
  });
  const proofStore = new LocalDiskProofStore(join(dataDir, 'uploads'));
  // With an AI key, rules and verdicts come from the model. Without one, rules come from a
  // template and the verdict is picked by hand on the proof screen, so the money flow can
  // still be exercised. PayPal is always the real sandbox.
  const aiApiKey = process.env.AI_API_KEY ?? '';
  const gemini = aiApiKey
    ? new GeminiClient({ apiKey: aiApiKey, model: process.env.AI_MODEL || 'gemini-3.6-flash' })
    : null;
  const manualVerifier = new ManualVerdictVerifier();
  const threshold = Number(process.env.CONFIDENCE_THRESHOLD);
  const appealWindowMinutes = Number(process.env.APPEAL_WINDOW_MINUTES);

  const app = createApp({
    ...createSqliteRepositories(openDatabase(join(dataDir, 'proofstake.db'))),
    passwordHasher: new ScryptPasswordHasher(),
    sessionTokens: new RandomSessionTokens(),
    bus: new InProcessEventBus(),
    clock: systemClock,
    ruleWriter: gemini ? new GeminiRuleWriter(gemini) : new TemplateRuleWriter(),
    proofVerifier: gemini ? new GeminiProofVerifier(gemini, (url) => proofStore.read(url)) : manualVerifier,
    proofStore,
    stakeHolds: new PayPalStakeHolds(paypal),
    methodVault: new PayPalMethodVault(paypal),
    refunds: new PayPalRefunds(paypal),
    goalDrafter: gemini ? new GeminiGoalAgent(gemini) : undefined,
    // The case agent gets PayPal's Agent Toolkit with lookups only. It cannot move money.
    caseAdvisor: gemini
      ? new GeminiCaseAgent(
          gemini,
          paypal.configured
            ? new PayPalReadOnlyTools({ clientId: paypalClientId, clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '' })
            : null,
          (url) => proofStore.read(url),
        )
      : undefined,
    payouts: new PayPalPayouts(paypal),
    appealWindowMs: appealWindowMinutes > 0 ? appealWindowMinutes * 60_000 : undefined,
    confidenceThreshold: threshold > 0 && threshold <= 1 ? threshold : undefined,
  });

  /** Announces passed deadlines, then retries any settlement whose PayPal call failed earlier. */
  const checkDeadlines = async () => {
    try {
      await app.goals.tickDeadlines();
      await app.settlement.retryPendingSettlements();
      await app.pacts.processPayouts();
    } catch (error) {
      console.error('[scheduler] deadline check failed', error);
    }
  };
  const scheduler = setInterval(checkDeadlines, DEADLINE_CHECK_MS);
  scheduler.unref();

  return {
    ...app,
    proofStore,
    manualVerifier,
    paypalClientId,
    paypalConfigured: paypal.configured,
    aiConfigured: gemini !== null,
    adminGate: new AdminGate(process.env.ADMIN_PASSWORD ?? ''),
    confidenceThreshold: threshold > 0 && threshold <= 1 ? threshold : undefined,
    checkDeadlines,
    revision: APP_REVISION,
    stop: () => clearInterval(scheduler),
  };
}

export type RunningApp = ReturnType<typeof buildRunningApp>;

const globalForApp = globalThis as typeof globalThis & { __proofstake?: RunningApp };

/** The one application instance of this server process, built on first use. */
export function getApp(): RunningApp {
  const cached = globalForApp.__proofstake;
  if (cached && cached.revision === APP_REVISION) return cached;
  cached?.stop?.();
  return (globalForApp.__proofstake = buildRunningApp());
}
