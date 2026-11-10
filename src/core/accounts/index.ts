import { createAccountsUseCases, type AccountsDeps } from './use-cases';

export type { PasswordHasher, PublicUser, Session, SessionRepository, SessionTokens, User, UserRepository } from './ports';
export { MIN_PASSWORD_LENGTH, SESSION_LIFETIME_MS } from './use-cases';

export function createAccountsModule(deps: AccountsDeps) {
  return createAccountsUseCases(deps);
}
export type AccountsModule = ReturnType<typeof createAccountsModule>;
