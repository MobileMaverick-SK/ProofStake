import { PayPalAgentToolkit } from '@paypal/agent-toolkit/bedrock';
import { simplifySchema, type AgentTools } from '../ai/agent-tools';
import { logServerError } from '../server-log';

/**
 * The only PayPal actions an AI agent is given: lookups. Nothing here can
 * create, capture, refund, void or pay out. Money is moved by deterministic
 * code in the settlement, appeals and pacts modules, never by a model.
 */
export const READ_ONLY_ACTIONS = {
  orders: { get: true },
  payments: { getRefunds: true },
  disputes: { list: true, get: true },
  transactions: { list: true },
} as const;

/** A second lock on the same door: a tool whose name is not here is refused even if the toolkit offers it. */
export const READ_ONLY_TOOL_NAMES = ['get_order', 'get_refund', 'list_disputes', 'get_dispute', 'list_transactions'] as const;

const MAX_RESULT_LENGTH = 4000;

/** PayPal's official Agent Toolkit, limited to read-only tools and pinned to the sandbox. */
export class PayPalReadOnlyTools implements AgentTools {
  private readonly toolkit: PayPalAgentToolkit;
  private readonly allowed = new Set<string>(READ_ONLY_TOOL_NAMES);

  constructor(credentials: { clientId: string; clientSecret: string }) {
    this.toolkit = new PayPalAgentToolkit({
      ...credentials,
      configuration: { actions: READ_ONLY_ACTIONS, context: { sandbox: true } },
    });
  }

  list() {
    return this.toolkit
      .getTools()
      .filter((tool) => this.allowed.has(tool.toolSpec.name))
      .map((tool) => ({
        name: tool.toolSpec.name,
        description: tool.toolSpec.description.replace(/\s+/g, ' ').trim().slice(0, 600),
        parameters: simplifySchema(tool.toolSpec.inputSchema.json),
      }));
  }

  async call(name: string, args: Record<string, unknown>) {
    if (!this.allowed.has(name)) return { ok: false, text: `The tool "${name}" is not available.` };
    try {
      const result = await this.toolkit.handleToolCall({ toolUseId: name, name, input: args });
      const text = result.content.map((part) => part.text).join('\n');
      const failed = /\\?"error\\?"\s*:/.test(text.slice(0, 200));
      if (failed) logServerError('paypal-agent', `${name} failed: ${text.slice(0, 300)}`);
      return { ok: !failed, text: text.slice(0, MAX_RESULT_LENGTH) };
    } catch (error) {
      logServerError('paypal-agent', `${name} threw: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, text: 'The lookup failed.' };
    }
  }
}
