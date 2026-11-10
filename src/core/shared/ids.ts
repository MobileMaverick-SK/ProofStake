/** Opaque unique id, optionally prefixed so ids are recognisable in logs ("goal_...", "case_..."). */
export function newId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}
