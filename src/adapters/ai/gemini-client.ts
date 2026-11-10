const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const REQUEST_TIMEOUT_MS = 60_000;

export interface GeminiConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Injected so tests can stand in for the network. The running app uses the real fetch. */
  fetchFn?: typeof fetch;
}

export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

/** A part as it appears in a conversation: what we send, plus what the model may send back. */
export interface GeminiTurnPart {
  text?: string;
  thought?: boolean;
  inline_data?: { mime_type: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  [other: string]: unknown;
}
export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiTurnPart[];
}
/** A tool the model may ask for. `parameters` is a plain JSON schema object. */
export interface GeminiFunction {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Anything that went wrong while asking the model. `retryable` is false when asking again cannot help. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Minimal Gemini `generateContent` client: JSON answers, and conversations with tool calls. */
export class GeminiClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly config: GeminiConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  get model(): string {
    return this.config.model;
  }

  /** One JSON answer. Pass `parts` for a single question, or `contents` for a whole conversation so far. */
  async generateJson(input: { system: string; parts?: GeminiPart[]; contents?: GeminiContent[] }): Promise<unknown> {
    const content = await this.call({
      system_instruction: { parts: [{ text: input.system }] },
      contents: input.contents ?? [{ role: 'user', parts: input.parts ?? [] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    });
    const text = content.parts
      .filter((part) => typeof part.text === 'string' && !part.thought)
      .map((part) => part.text)
      .join('');
    if (!text) throw new AiError('The AI service returned no text.', true);
    try {
      // Tolerate a fenced code block around the JSON, which models sometimes add.
      return JSON.parse(text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''));
    } catch {
      throw new AiError('The AI service returned text that is not JSON.', true);
    }
  }

  /**
   * One turn of a conversation in which the model may ask for tools to be run.
   * Returns the model's turn exactly as sent, so it can be appended to the conversation unchanged.
   */
  async generateTurn(input: { system: string; contents: GeminiContent[]; tools: GeminiFunction[] }): Promise<GeminiContent> {
    return this.call({
      system_instruction: { parts: [{ text: input.system }] },
      contents: input.contents,
      ...(input.tools.length > 0 ? { tools: [{ functionDeclarations: input.tools }] } : {}),
      generationConfig: { temperature: 0.2 },
    });
  }

  private async call(body: unknown): Promise<GeminiContent> {
    let response: Response;
    try {
      response = await this.fetchFn(
        `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.config.model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': this.config.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch (error) {
      throw new AiError(`The AI service could not be reached: ${String(error)}`, true);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      if (response.status === 404) {
        throw new AiError(`The AI model "${this.config.model}" was not found. Check AI_MODEL. ${detail}`, false);
      }
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new AiError(`The AI service rejected the request (${response.status}). Check AI_API_KEY. ${detail}`, false);
      }
      // 429 (rate limit) and 5xx are worth one more try.
      throw new AiError(`The AI service answered ${response.status}. ${detail}`, true);
    }

    const payload = (await response.json().catch(() => null)) as { candidates?: { content?: Partial<GeminiContent> }[] } | null;
    const content = payload?.candidates?.[0]?.content;
    if (!content || !Array.isArray(content.parts) || content.parts.length === 0) {
      throw new AiError('The AI service returned an empty answer.', true);
    }
    return { role: 'model', parts: content.parts };
  }
}

/**
 * Runs `attempt` and, if it fails in a way that asking again might fix
 * (invalid JSON, a failed validation, a rate limit), runs it exactly once more.
 */
export async function withOneRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof AiError && !error.retryable) throw error;
    return attempt();
  }
}
