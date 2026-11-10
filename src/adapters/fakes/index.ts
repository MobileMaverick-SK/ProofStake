import type { DomainEvent } from '../../core/shared';
import { RandomSessionTokens, ScryptPasswordHasher } from '../auth';
import { InProcessEventBus } from '../events/in-process-event-bus';
import { FakeClock } from './fake-clock';
import { FakePayouts } from './fake-payouts';
import { FakeProofStore } from './fake-proof-store';
import { FakeProofVerifier } from './fake-proof-verifier';
import { FakeRefunds } from './fake-refunds';
import { FakeRuleWriter } from './fake-rule-writer';
import { FakeStakeHolds } from './fake-stake-holds';
import {
  InMemoryGoalRepository,
  InMemoryPactRepository,
  InMemoryProofRepository,
  InMemoryReviewRepository,
  InMemoryRulesRepository,
  InMemorySavedMethodRepository,
  InMemorySessionRepository,
  InMemoryStakeRepository,
  InMemoryUserRepository,
  InMemoryVerdictRepository,
} from './in-memory-repositories';

export * from './fake-clock';
export * from './fake-payouts';
export * from './fake-proof-store';
export * from './fake-proof-verifier';
export * from './fake-refunds';
export * from './fake-rule-writer';
export * from './fake-stake-holds';
export * from './in-memory-repositories';

/** One in-memory implementation of every port, plus a record of handler failures. */
export function createFakePorts() {
  const handlerErrors: { error: unknown; event: DomainEvent }[] = [];
  const stakeHolds = new FakeStakeHolds();
  return {
    handlerErrors,
    bus: new InProcessEventBus((error, event) => handlerErrors.push({ error, event })),
    clock: new FakeClock(),
    goalRepository: new InMemoryGoalRepository(),
    rulesRepository: new InMemoryRulesRepository(),
    proofRepository: new InMemoryProofRepository(),
    verdictRepository: new InMemoryVerdictRepository(),
    stakeRepository: new InMemoryStakeRepository(),
    reviewRepository: new InMemoryReviewRepository(),
    savedMethodRepository: new InMemorySavedMethodRepository(),
    userRepository: new InMemoryUserRepository(),
    sessionRepository: new InMemorySessionRepository(),
    passwordHasher: new ScryptPasswordHasher(),
    sessionTokens: new RandomSessionTokens(),
    ruleWriter: new FakeRuleWriter(),
    proofVerifier: new FakeProofVerifier(),
    proofStore: new FakeProofStore(),
    stakeHolds,
    methodVault: stakeHolds,
    refunds: new FakeRefunds(),
    pactRepository: new InMemoryPactRepository(),
    payouts: new FakePayouts(),
  };
}
export type FakePorts = ReturnType<typeof createFakePorts>;
