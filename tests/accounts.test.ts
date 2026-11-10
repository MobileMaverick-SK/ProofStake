import { describe, expect, it } from 'vitest';
import { SESSION_LIFETIME_MS } from '../src/core/accounts';
import { BACKENDS, HOUR, setup } from './helpers';

const person = { name: 'Asha Rao', email: 'Asha@Example.com ', password: 'correct horse battery' };

describe.each(BACKENDS)('accounts ($name)', (backend) => {
  it('registers, signs in, and signs out', async () => {
    const { app } = setup({}, backend);
    const registered = await app.accounts.register(person);
    expect(registered.user).toEqual({ id: registered.user.id, name: 'Asha Rao', email: 'asha@example.com' });
    expect(await app.accounts.authenticate(registered.token)).toEqual(registered.user);

    const signedIn = await app.accounts.login({ email: 'ASHA@example.com', password: person.password });
    expect(signedIn.user).toEqual(registered.user);
    expect(signedIn.token).not.toBe(registered.token);

    await app.accounts.logout(signedIn.token);
    expect(await app.accounts.authenticate(signedIn.token)).toBeNull();
    expect(await app.accounts.authenticate(registered.token)).toEqual(registered.user); // other devices stay signed in
  });

  it('never stores the password or the session token in the clear', async () => {
    const { app, ports } = setup({}, backend);
    const { user, token } = await app.accounts.register(person);
    const stored = await ports.userRepository.getById(user.id);
    expect(stored!.passwordHash).toMatch(/^scrypt\$/);
    expect(stored!.passwordHash).not.toContain(person.password);
    expect(await ports.sessionRepository.get(token)).toBeNull();
    expect(await ports.sessionRepository.get(ports.sessionTokens.hash(token))).not.toBeNull();
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { app } = setup({}, backend);
    await app.accounts.register(person);
    const wrongPassword = await app.accounts.login({ email: 'asha@example.com', password: 'nope-nope' }).catch((e) => e);
    const unknownEmail = await app.accounts.login({ email: 'nobody@example.com', password: 'nope-nope' }).catch((e) => e);
    expect(wrongPassword).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(unknownEmail.message).toBe(wrongPassword.message);
  });

  it('rejects a duplicate email, a bad email, and a short password', async () => {
    const { app } = setup({}, backend);
    await app.accounts.register(person);
    await expect(app.accounts.register({ ...person, email: 'asha@example.com' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(app.accounts.register({ ...person, email: 'not-an-email' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(app.accounts.register({ ...person, email: 'b@example.com', password: 'short' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('expires sessions and ignores made-up tokens', async () => {
    const { app, ports } = setup({}, backend);
    const { token } = await app.accounts.register(person);
    expect(await app.accounts.authenticate('made-up-token')).toBeNull();
    expect(await app.accounts.authenticate('')).toBeNull();
    ports.clock.advance(SESSION_LIFETIME_MS + 1);
    expect(await app.accounts.authenticate(token)).toBeNull();
  });

  it('keeps each person to their own goals', async () => {
    const { app, ports } = setup({}, backend);
    const asha = (await app.accounts.register(person)).user;
    const ben = (await app.accounts.register({ name: 'Ben', email: 'ben@example.com', password: 'another password' })).user;
    const goal = await app.goals.createGoal({
      userId: asha.id,
      text: 'Finish chapter 3 notes',
      deadline: new Date(ports.clock.now().getTime() + HOUR),
      stakeCents: 2000,
    });

    expect(await app.goals.listGoals(asha.id)).toHaveLength(1);
    expect(await app.goals.listGoals(ben.id)).toHaveLength(0);
    expect((await app.goals.getOwnedGoal(asha.id, goal.id)).id).toBe(goal.id);
    await expect(app.goals.getOwnedGoal(ben.id, goal.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
