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

/** Minimal Gemini `generateContent` client that asks for JSON and returns the parsed value. */
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

  async generateJson(input: { system: string; parts: GeminiPart[] }): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(
        `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.config.model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': this.config.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: input.system }] },
            contents: [{ role: 'user', parts: input.parts }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
          }),
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

    const payload = (await response.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    } | null;
    const text = (payload?.candidates?.[0]?.content?.parts ?? [])
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
