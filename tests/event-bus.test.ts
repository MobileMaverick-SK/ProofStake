import { describe, expect, it } from 'vitest';
import { InProcessEventBus } from '../src/adapters/events/in-process-event-bus';
import type { DomainEvent } from '../src/core/shared';

describe('in-process event bus', () => {
  it('finishes an event for every subscriber before starting a follow-up event', async () => {
    const bus = new InProcessEventBus();
    const log: string[] = [];
    // First subscriber publishes a follow-up; the second must still see the original event first.
    bus.subscribe('StakeHeld', async (e) => {
      log.push('A:StakeHeld');
      await bus.publish({ type: 'DeadlinePassed', goalId: e.goalId });
    });
    bus.subscribe('StakeHeld', async () => {
      log.push('B:StakeHeld');
    });
    bus.subscribe('DeadlinePassed', async () => {
      log.push('B:DeadlinePassed');
    });

    await bus.publish({ type: 'StakeHeld', goalId: 'g', authorizationId: 'a', amount: { cents: 1, currency: 'USD' } });

    expect(log).toEqual(['A:StakeHeld', 'B:StakeHeld', 'B:DeadlinePassed']);
  });

  it('publish resolves only after the whole chain of follow-up events is handled', async () => {
    const bus = new InProcessEventBus();
    let finished = false;
    bus.subscribe('GoalCreated', (e) => bus.publish({ type: 'RulesProposed', goalId: e.goalId }));
    bus.subscribe('RulesProposed', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = true;
    });

    await bus.publish({
      type: 'GoalCreated',
      goalId: 'g',
      userId: 'u',
      goalText: 't',
      deadline: new Date(),
      stake: { cents: 100, currency: 'USD' },
    });

    expect(finished).toBe(true);
  });

  it('two concurrent publishes are both fully handled before either resolves', async () => {
    const bus = new InProcessEventBus();
    const handled: string[] = [];
    bus.subscribe('DeadlinePassed', async (e) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      handled.push(e.goalId);
    });
    await Promise.all([
      bus.publish({ type: 'DeadlinePassed', goalId: '1' }).then(() => expect(handled).toContain('1')),
      bus.publish({ type: 'DeadlinePassed', goalId: '2' }).then(() => expect(handled).toContain('2')),
    ]);
    expect(handled).toEqual(['1', '2']);
  });

  it('a failing handler is reported and does not stop the others', async () => {
    const errors: DomainEvent[] = [];
    const bus = new InProcessEventBus((_error, event) => errors.push(event));
    let reached = false;
    bus.subscribe('StakeReleased', async () => {
      throw new Error('boom');
    });
    bus.subscribe('StakeReleased', async () => {
      reached = true;
    });

    await bus.publish({ type: 'StakeReleased', goalId: 'g' });

    expect(reached).toBe(true);
    expect(errors).toEqual([{ type: 'StakeReleased', goalId: 'g' }]);
  });
});
