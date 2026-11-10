import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_MS = 8 * 60 * 60 * 1000;

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Guards the review queue with one shared password (ADMIN_PASSWORD). With no
 * password configured the queue is closed to everyone, never open to everyone.
 * Reviewer sessions live in memory, so they end when the server restarts.
 */
export class AdminGate {
  private readonly sessions = new Map<string, number>();

  constructor(
    private readonly password: string,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this.password.length > 0;
  }

  /** A session token for the right password, otherwise null. */
  login(attempt: string): string | null {
    if (!this.enabled || !timingSafeEqual(digest(attempt), digest(this.password))) return null;
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, this.now() + SESSION_MS);
    return token;
  }

  check(token: string | undefined | null): boolean {
    if (!token) return false;
    const expiresAt = this.sessions.get(token);
    if (!expiresAt) return false;
    if (expiresAt <= this.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  logout(token: string): void {
    this.sessions.delete(token);
  }
}
