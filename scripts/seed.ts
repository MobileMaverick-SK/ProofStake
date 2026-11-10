/**
 * Seed script: `npm run seed`.
 *
 * Creates a demo account and two goals whose proof rules are already accepted,
 * so the first thing to do after signing in is place a real PayPal sandbox
 * hold. It deliberately creates nothing that involves money: every hold,
 * capture and refund you see in the app comes from the real PayPal sandbox.
 *
 * Safe to run twice: if the demo account exists, nothing is changed.
 * Reads DATA_DIR, SEED_EMAIL and SEED_PASSWORD from the environment.
 */
import { join } from 'node:path';
import { it } from 'vitest';
import { TemplateRuleWriter } from '../src/adapters/ai';
import { createSqliteRepositories, openDatabase } from '../src/adapters/db';
import { createFakePorts } from '../src/adapters/fakes';
import { systemClock } from '../src/adapters/system-clock';
import { createApp } from '../src/composition-root';

const HOUR = 60 * 60 * 1000;

it('seeds the demo account', async () => {
  const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
  const email = process.env.SEED_EMAIL || 'demo@proofstake.test';
  const password = process.env.SEED_PASSWORD || 'demo-password';

  // Real storage and clock. The payment and AI ports are never reached by this script.
  const app = createApp({
    ...createFakePorts(),
    ...createSqliteRepositories(openDatabase(join(dataDir, 'proofstake.db'))),
    clock: systemClock,
    ruleWriter: new TemplateRuleWriter(),
  });

  let userId: string;
  try {
    userId = (await app.accounts.register({ name: 'Demo User', email, password })).user.id;
  } catch {
    console.log(`Already seeded: ${email} exists. Nothing was changed.`);
    return;
  }

  const goals = [
    { text: 'Finish my chapter 3 notes, all 12 pages', hours: 24, stakeCents: 2000 },
    { text: 'Solve practice problems 1 to 20 on paper', hours: 72, stakeCents: 1000 },
  ];
  for (const goal of goals) {
    const created = await app.goals.createGoal({
      userId,
      text: goal.text,
      deadline: new Date(Date.now() + goal.hours * HOUR - 60_000),
      stakeCents: goal.stakeCents,
    });
    await app.proofRules.acceptRules(created.id);
  }
  console.log(`Seeded ${email} with ${goals.length} goals waiting for a PayPal hold. Sign in with the password from SEED_PASSWORD (default in README).`);
});
