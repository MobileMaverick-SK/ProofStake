import type { AgentTools } from './agent-tools';
import { withOneRetry, type GeminiClient, type GeminiContent, type GeminiTurnPart } from './gemini-client';

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
}

/**
 * Lets the model call tools until it stops asking or the step limit is reached,
 * then asks one last question that must be answered in JSON. The conversation is
 * kept exactly as the model sent it, because some models sign their tool calls.
 */
export async function runAgent(input: {
  gemini: GeminiClient;
  system: string;
  opening: GeminiTurnPart[];
  tools: AgentTools | null;
  maxSteps: number;
  finalQuestion: string;
}): Promise<{ answer: () => Promise<unknown>; steps: AgentStep[] }> {
  const { gemini, system, tools, maxSteps } = input;
  const contents: GeminiContent[] = [{ role: 'user', parts: input.opening }];
  const declarations = tools?.list() ?? [];
  const steps: AgentStep[] = [];

  for (let step = 0; step < maxSteps && declarations.length > 0; step++) {
    const turn = await withOneRetry(() => gemini.generateTurn({ system, contents, tools: declarations }));
    contents.push(turn);
    const calls = turn.parts.filter((part) => part.functionCall);
    if (calls.length === 0) break;
    const answers: GeminiTurnPart[] = [];
    for (const part of calls) {
      const { name, args = {} } = part.functionCall!;
      const result = await tools!.call(name, args);
      steps.push({ tool: name, args, ok: result.ok });
      answers.push({ functionResponse: { name, response: { result: result.text } } });
    }
    contents.push({ role: 'user', parts: answers });
  }

  contents.push({ role: 'user', parts: [{ text: input.finalQuestion }] });
  // A function, so the caller can validate the answer and ask once more if it is malformed.
  return { answer: () => gemini.generateJson({ system, contents }), steps };
}
