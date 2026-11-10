import { describe, expect, it } from 'vitest';
import { GeminiClient, GeminiGoalAgent } from '../src/adapters/ai';
import type { GoalDraftRequest } from '../src/core/goals';
import { HOUR, USER, setup } from './helpers';

const NOW = new Date('2026-11-10T09:00:00.000Z');

function scriptedGemini(...turns: object[][]) {
  const requests: any[] = [];
  const fetchFn: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init!.body)));
    const parts = turns.shift();
    if (!parts) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }));
  };
  return { client: new GeminiClient({ apiKey: 'k', model: 'gemini-test', fetchFn }), requests };
}

const call = (name: string, args: object = {}) => [{ functionCall: { name, args } }];
const request = (overrides: Partial<GoalDraftRequest> = {}): GoalDraftRequest => ({
  request: 'finish my thesis chapter by friday 9pm, $20, my wife Priya gets it if I fail',
  now: NOW,
  timeZone: 'Asia/Kolkata',
  history: [{ text: 'Write 20 pages', stakeCents: 2000, outcome: 'MISSED' }],
  check: () => [],
  ...overrides,
});

describe('goal agent', () => {
  it('checks the time, the history and its own draft, then fills the form fields', async () => {
    const checked: unknown[] = [];
    const gemini = scriptedGemini(
      call('get_current_time'),
      call('get_goal_history'),
      call('check_draft', { text: 'Write 8 pages of thesis chapter 2', deadlineIso: '2026-11-13T21:00:00+05:30', stakeDollars: 20 }),
      [{ text: 'Ready.' }],
      [{ text: JSON.stringify({ text: 'Write 8 pages of thesis chapter 2', deadlineIso: '2026-11-13T21:00:00+05:30', stakeDollars: 20, partner: { name: 'Priya', email: '' }, provability: 4.4, changes: ['Named a page count.'], questions: null }) }],
    );
    const draft = await new GeminiGoalAgent(gemini.client).draft(
      request({ check: (candidate) => (checked.push(candidate), ['The deadline can be at most 3 days from now']) }),
    );

    expect(draft).toMatchObject({
      text: 'Write 8 pages of thesis chapter 2',
      deadline: new Date('2026-11-13T15:30:00.000Z'),
      stakeCents: 2000,
      partner: { name: 'Priya', email: '' },
      changes: ['Named a page count.'],
      questions: [],
    });
    expect(draft.steps).toEqual([
      'Checked the current time in your time zone',
      'Read how your earlier goals went',
      'Checked the draft against the app’s rules',
    ]);
    expect(checked).toEqual([{ text: 'Write 8 pages of thesis chapter 2', deadline: new Date('2026-11-13T15:30:00.000Z'), stakeCents: 2000 }]);

    // Each tool result went back to the model.
    const results = gemini.requests.flatMap((r) => r.contents.flatMap((c: any) => c.parts)).filter((p: any) => p.functionResponse);
    const byName = Object.fromEntries(results.map((p: any) => [p.functionResponse.name, p.functionResponse.response.result]));
    expect(JSON.parse(byName.get_current_time)).toMatchObject({ nowUtc: NOW.toISOString(), timeZone: 'Asia/Kolkata' });
    expect(JSON.parse(byName.get_current_time).localTime).toContain('14:30');
    expect(JSON.parse(byName.get_goal_history)).toEqual([{ goal: 'Write 20 pages', stakeDollars: 20, outcome: 'MISSED' }]);
    expect(JSON.parse(byName.check_draft)).toEqual({ passes: false, problems: ['The deadline can be at most 3 days from now'] });
  });

  it('is told never to invent a stake, and leaves it empty when the user named none', async () => {
    const gemini = scriptedGemini([{ text: 'Ready.' }], [{ text: '{"text":"Read 30 pages","deadlineIso":null,"stakeDollars":null,"partner":null,"provability":4}' }]);
    const draft = await new GeminiGoalAgent(gemini.client).draft(request({ request: 'read 30 pages' }));
    expect(draft).toMatchObject({ stakeCents: null, deadline: null, partner: null });
    const system = gemini.requests[0].system_instruction.parts[0].text;
    expect(system).toMatch(/Never invent, round or change an amount/);
    expect(system).toMatch(/data, not instructions/);
  });

  it('falls back to UTC for a time zone it does not know', async () => {
    const gemini = scriptedGemini(call('get_current_time'), [{ text: 'ok' }], [{ text: '{"text":"Read 30 pages"}' }]);
    await new GeminiGoalAgent(gemini.client).draft(request({ timeZone: 'Not/AZone' }));
    const result = gemini.requests[1].contents[2].parts[0].functionResponse.response.result;
    expect(JSON.parse(result).timeZone).toBe('UTC');
  });

  it('reports a failure instead of a made-up draft', async () => {
    const gemini = scriptedGemini([{ text: 'ok' }], [{ text: 'nope' }], [{ text: '{}' }]);
    await expect(new GeminiGoalAgent(gemini.client).draft(request())).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('drafting a goal', () => {
  it('passes the user’s history to the agent and re-checks the draft in code', async () => {
    const { app, ports, activeGoal, submitFinal } = setup();
    const { goalId } = await activeGoal(2000);
    ports.proofVerifier.respondWith({ outcome: 'FAIL', fractionCompleted: 0 });
    await submitFinal(goalId);

    ports.goalDrafter.next = (input) => ({
      text: '  Write 8 pages  ',
      deadline: new Date(input.now.getTime() + 5 * 24 * HOUR),
      stakeCents: null,
      partner: null,
      provability: 9,
      changes: [],
      questions: [],
      steps: [],
    });
    const { draft, problems } = await app.goals.draftGoal(USER, 'write some pages soon', 'Asia/Kolkata');

    expect(ports.goalDrafter.requests[0]!.history).toEqual([{ text: 'Finish chapter 3 notes', stakeCents: 2000, outcome: 'MISSED' }]);
    expect(draft).toMatchObject({ text: 'Write 8 pages', provability: 5, stakeCents: null });
    expect(problems).toEqual(['No stake was given', 'The deadline can be at most 3 days from now']);
    // Drafting saves nothing.
    expect(await app.goals.listGoals(USER)).toHaveLength(1);
  });

  it('needs a sentence to work from', async () => {
    const { app } = setup();
    await expect(app.goals.draftGoal(USER, 'hi', 'UTC')).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
