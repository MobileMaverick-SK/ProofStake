import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PasswordHasher, SessionTokens } from '../../core/accounts';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keyLength: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

/** Passwords are stored as "scrypt$<salt>$<key>", each part base64url, with a random salt per password. */
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scryptAsync(password, salt, KEY_LENGTH);
    return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [scheme, salt, key] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !key) return false;
    const expected = Buffer.from(key, 'base64url');
    const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}

/** 256-bit random session tokens. The database only ever sees their SHA-256 hash. */
export class RandomSessionTokens implements SessionTokens {
  issue() {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

export { AdminGate } from './admin-gate';
