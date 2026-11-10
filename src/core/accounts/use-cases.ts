import { z } from 'zod';
import { DomainError, newId, type Clock } from '../shared';
import type { PasswordHasher, PublicUser, SessionRepository, SessionTokens, User, UserRepository } from './ports';

export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

const registrationSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80),
  email: z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address'),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use a password of at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(200),
});

export interface AccountsDeps {
  users: UserRepository;
  sessions: SessionRepository;
  hasher: PasswordHasher;
  tokens: SessionTokens;
  clock: Clock;
}

const toPublic = (user: User): PublicUser => ({ id: user.id, name: user.name, email: user.email });

export function createAccountsUseCases({ users, sessions, hasher, tokens, clock }: AccountsDeps) {
  async function startSession(user: User): Promise<{ user: PublicUser; token: string; expiresAt: Date }> {
    const { token, tokenHash } = tokens.issue();
    const expiresAt = new Date(clock.now().getTime() + SESSION_LIFETIME_MS);
    await sessions.save({ tokenHash, userId: user.id, expiresAt });
    return { user: toPublic(user), token, expiresAt };
  }

  return {
    async register(input: { name: string; email: string; password: string }) {
      const parsed = registrationSchema.safeParse(input);
      if (!parsed.success) {
        throw new DomainError('VALIDATION', parsed.error.issues.map((issue) => issue.message).join('. '));
      }
      if (await users.getByEmail(parsed.data.email)) {
        throw new DomainError('CONFLICT', 'An account with this email already exists. Sign in instead.');
      }
      const user: User = {
        id: newId('user'),
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash: await hasher.hash(parsed.data.password),
        createdAt: clock.now(),
      };
      await users.save(user);
      return startSession(user);
    },

    async login(input: { email: string; password: string }) {
      const user = await users.getByEmail(String(input.email).trim().toLowerCase());
      // The same answer for "no such account" and "wrong password", so emails cannot be probed.
      const correct = user
        ? await hasher.verify(String(input.password), user.passwordHash)
        : (await hasher.hash(String(input.password)), false);
      if (!user || !correct) throw new DomainError('UNAUTHENTICATED', 'Email or password is incorrect.');
      return startSession(user);
    },

    async logout(token: string): Promise<void> {
      await sessions.delete(tokens.hash(token));
    },

    /** The signed-in user for a session token, or null if the token is unknown or expired. */
    async authenticate(token: string): Promise<PublicUser | null> {
      if (!token) return null;
      const tokenHash = tokens.hash(token);
      const session = await sessions.get(tokenHash);
      if (!session) return null;
      if (session.expiresAt.getTime() <= clock.now().getTime()) {
        await sessions.delete(tokenHash);
        return null;
      }
      const user = await users.getById(session.userId);
      return user ? toPublic(user) : null;
    },
  };
}
