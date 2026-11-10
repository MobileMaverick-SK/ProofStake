/** Tools an agent may call to look things up. Implementations decide what is reachable; the agent cannot add to it. */
export interface AgentTools {
  list(): { name: string; description: string; parameters: Record<string, unknown> }[];
  /** Runs one tool and returns its result as text. Never throws: a failure is returned as text for the agent to read. */
  call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
}

const KEPT = new Set(['type', 'description', 'enum', 'properties', 'required', 'items']);

/**
 * Reduces a JSON schema to the plain subset every function-calling model accepts:
 * no $schema, patterns, defaults or unions. A union keeps its first real branch.
 */
export function simplifySchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return { type: 'string' };
  const source = schema as Record<string, unknown>;
  const union = (source.anyOf ?? source.oneOf) as unknown[] | undefined;
  if (Array.isArray(union)) {
    const real = union.find((branch) => {
      const candidate = branch as Record<string, unknown> | null;
      return candidate && typeof candidate === 'object' && candidate.type !== 'null' && !('not' in candidate);
    });
    const simplified = simplifySchema(real ?? { type: 'string' });
    if (typeof source.description === 'string' && !simplified.description) simplified.description = source.description;
    return simplified;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!KEPT.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      result.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, simplifySchema(child)]),
      );
    } else if (key === 'items') {
      result.items = simplifySchema(value);
    } else {
      result[key] = value;
    }
  }
  if (!result.type) result.type = result.properties ? 'object' : 'string';
  return result;
}
