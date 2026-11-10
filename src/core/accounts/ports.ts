export interface User {
  id: string;
  name: string;
  /** stored lower-cased; unique */
  email: string;
  passwordHash: string;
  createdAt: Date;
}

/** What the rest of the app may know about a user. Never includes the password hash. */
export type PublicUser = Pick<User, 'id' | 'name' | 'email'>;

export interface Session {
  /** Only a hash of the session token is stored, so a leaked database cannot be used to sign in. */
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

export interface UserRepository {
  getById(userId: string): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

export interface SessionRepository {
  get(tokenHash: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(tokenHash: string): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export interface SessionTokens {
  /** A new random token for the browser, and the hash of it to store. */
  issue(): { token: string; tokenHash: string };
  hash(token: string): string;
}
