import { describe, expect, it } from 'vitest';
import { AdminGate } from '../src/adapters/auth';

describe('admin gate', () => {
  it('is closed to everyone when no password is configured', () => {
    const gate = new AdminGate('');
    expect(gate.enabled).toBe(false);
    expect(gate.login('')).toBeNull();
    expect(gate.login('anything')).toBeNull();
  });

  it('gives a session only for the right password', () => {
    const gate = new AdminGate('correct horse');
    expect(gate.login('wrong')).toBeNull();
    expect(gate.login('correct hors')).toBeNull();
    const token = gate.login('correct horse')!;
    expect(gate.check(token)).toBe(true);
    expect(gate.check('made-up')).toBe(false);
    expect(gate.check(undefined)).toBe(false);
    gate.logout(token);
    expect(gate.check(token)).toBe(false);
  });

  it('expires sessions after 8 hours', () => {
    let now = 0;
    const gate = new AdminGate('pw-pw-pw', () => now);
    const token = gate.login('pw-pw-pw')!;
    now = 8 * 60 * 60 * 1000 - 1;
    expect(gate.check(token)).toBe(true);
    now += 2;
    expect(gate.check(token)).toBe(false);
  });
});
