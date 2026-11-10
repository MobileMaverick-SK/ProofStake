import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Writes one line to data/server.log as well as the console. Provider error
 * details (PayPal issue codes, AI failures) go here: they are needed to
 * diagnose a failed payment, and must never be sent to the browser.
 */
export function logServerError(scope: string, message: string): void {
  console.error(`[${scope}] ${message}`);
  if (process.env.VITEST) return; // tests provoke errors on purpose; keep them out of the log file
  try {
    const directory = process.env.DATA_DIR || join(process.cwd(), 'data');
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(/* turbopackIgnore: true */ directory, 'server.log'), `${new Date().toISOString()} [${scope}] ${message}\n`);
  } catch {
    // Logging must never break the request that is being logged.
  }
}
