import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * Each table keeps the columns we query on, plus the whole record as JSON in
 * `data`. The schema is created on open, so there is no migration step to run.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  deadline TEXT NOT NULL,
  deadline_announced INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS goals_due ON goals (state, deadline_announced, deadline);
CREATE TABLE IF NOT EXISTS rules (goal_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proof_slots (goal_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS verdicts (goal_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stakes (goal_id TEXT PRIMARY KEY, pending INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS captures (goal_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS saved_methods (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pending_method_setups (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS review_cases (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS review_cases_by_goal ON review_cases (goal_id);
`;

/** Opens (and if needed creates) the SQLite database. Pass ":memory:" for tests. */
export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  // Databases created before accounts existed have a goals table without an owner column.
  const goalColumns = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[];
  if (!goalColumns.some((column) => column.name === 'user_id')) {
    db.exec(`ALTER TABLE goals ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS goals_by_user ON goals (user_id, created_at)');
  return db;
}

/** JSON that keeps Date values as dates on the way back out. */
export function encode(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key: string, plain: unknown) {
    const raw = this[key];
    return raw instanceof Date ? { $date: raw.toISOString() } : plain;
  });
}

export function decode<T>(text: string): T {
  return JSON.parse(text, (_key, value: unknown) => {
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      const date = (value as { $date?: unknown }).$date;
      if (keys.length === 1 && typeof date === 'string') return new Date(date);
    }
    return value;
  }) as T;
}
