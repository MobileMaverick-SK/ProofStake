import { createSqliteRepositories, openDatabase } from '../src/adapters/db';
import { createFakePorts } from '../src/adapters/fakes';
import { createApp } from '../src/composition-root';

/** The storage backends every flow test runs against. */
export const BACKENDS = [
  { name: 'in-memory repositories', repositories: () => ({}) },
  { name: 'SQLite repositories', repositories: () => createSqliteRepositories(openDatabase(':memory:')) },
] as const;
export type Backend = (typeof BACKENDS)[number];

export const USER = 'user_test';
export const HOUR = 60 * 60 * 1000;
export const TEST_CODE = 'TEST42';
export const PHOTO = Buffer.from('not really a jpeg');

/** The whole application on in-memory fakes. */
export function setup(options: { confidenceThreshold?: number } = {}, backend: Backend = BACKENDS[0]) {
  const ports = { ...createFakePorts(), ...backend.repositories() };
  const app = createApp({ ...ports, generateCode: () => TEST_CODE, ...options });

  /** Drives a new goal through rules and the PayPal hold until it is ACTIVE. */
  async function activeGoal(stakeCents = 2000, hoursUntilDeadline = 24) {
    const goal = await app.goals.createGoal({
      userId: USER,
      text: 'Finish chapter 3 notes',
      deadline: new Date(ports.clock.now().getTime() + hoursUntilDeadline * HOUR),
      stakeCents,
    });
    await app.proofRules.acceptRules(goal.id);
    const { orderId } = await app.settlement.startHold(goal.id);
    ports.stakeHolds.approve(orderId);
    const stake = await app.settlement.confirmHold(goal.id);
    return { goalId: goal.id, authorizationId: stake.authorizationId! };
  }

  const submit = (goalId: string) => app.proofIntake.submitProof({ goalId, file: PHOTO, mimeType: 'image/jpeg' });
  /** Uploads a photo and, if the result can still be improved on, takes it as final right away. */
  const submitFinal = async (goalId: string) => {
    await submit(goalId);
    await app.settlement.acceptResult(goalId).catch(() => {});
  };
  const stateOf = async (goalId: string) => (await app.goals.getGoal(goalId)).state;

  return { ports, app, activeGoal, submit, submitFinal, stateOf };
}
