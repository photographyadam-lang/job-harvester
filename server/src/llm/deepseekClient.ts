/**
 * DeepSeek Chat API client.
 *
 * This module owns all LLM interaction in the pipeline. No stage module calls
 * DeepSeek directly — every LLM call goes through `callDeepSeek`.
 *
 * Key behaviours:
 *   - Uses the `openai` npm package configured with `baseURL` pointing to
 *     DeepSeek's API endpoint and `model: "deepseek-chat"`.
 *   - Enforces a minimum 1500 ms delay between consecutive calls via an
 *     internal rate limiter.
 *   - Reads `DEEPSEEK_API_KEY` from `process.env` only — never hardcoded.
 *   - Validates the response against a supplied schema via `schemaValidator`.
 *   - Never logs the full response content, only token counts.
 *   - Throws `LlmApiError` on API failure.
 *   - Throws `LlmSchemaError` on schema validation failure.
 */

import OpenAI from 'openai';
import { TokenUsage, estimateCost, CostBreakdown } from './costEstimator';
import { validateSchema, ValidationSchema, LlmSchemaError } from './schemaValidator';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class LlmApiError extends Error {
  /** HTTP status code, or 0 if the error is not HTTP-related. */
  public readonly statusCode: number;

  constructor(message: string, statusCode = 0) {
    super(message);
    this.name = 'LlmApiError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, LlmApiError.prototype);
  }
}

// Re-export LlmSchemaError for convenience
export { LlmSchemaError };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LlmResponse {
  /** The text content of the model's reply. */
  content: string;
  /** The model identifier used. */
  model: string;
  /** Token usage statistics from the API response. */
  usage: TokenUsage;
}

export interface DeepSeekClientConfig {
  /** Optional: custom model name. Defaults to "deepseek-chat". */
  model?: string;
  /** Optional: system prompt to include. */
  systemPrompt?: string;
  /** Optional: temperature. Defaults to 0. */
  temperature?: number;
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

class RateLimiter {
  private lastCallTime = 0;
  private readonly minDelayMs: number;

  constructor(minDelayMs: number) {
    this.minDelayMs = minDelayMs;
  }

  /**
   * Wait until the required delay has elapsed since the last call.
   */
  async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < this.minDelayMs) {
      const waitMs = this.minDelayMs - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastCallTime = Date.now();
  }
}

// ---------------------------------------------------------------------------
// Client instance
// ---------------------------------------------------------------------------

const rateLimiter = new RateLimiter(1500);

/**
 * Create an OpenAI-compatible client pointed at DeepSeek's API.
 */
function createClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new LlmApiError(
      'DEEPSEEK_API_KEY is not set in environment variables',
      0,
    );
  }

  return new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com',
    timeout: 30_000,
    maxRetries: 1,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _client: OpenAI | null = null;

/**
 * Call the DeepSeek Chat model with the given prompt and validate the
 * response against the supplied schema.
 *
 * @param prompt  - The user prompt to send.
 * @param schema  - A `ValidationSchema` to validate the parsed response against.
 * @param config  - Optional configuration overrides.
 *
 * @returns The parsed `LlmResponse` on success.
 *
 * @throws {LlmApiError}     On API failure (network, auth, rate-limit, etc.).
 * @throws {LlmSchemaError}  When the response JSON does not match the schema.
 */
export async function callDeepSeek(
  prompt: string,
  schema: ValidationSchema,
  config: DeepSeekClientConfig = {},
): Promise<LlmResponse> {
  // Enforce rate limit before making the call
  await rateLimiter.throttle();

  const client = _client ?? createClient();
  const model = config.model ?? 'deepseek-chat';
  const temperature = config.temperature ?? 0;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (config.systemPrompt) {
    messages.push({ role: 'system', content: config.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const promptPreview =
    prompt.length > 120 ? prompt.slice(0, 120) + '...' : prompt;
  console.log(`[DeepSeek] Sending request | model=${model} prompt="${promptPreview}"`);

  let response: OpenAI.Chat.ChatCompletion;

  try {
    response = await client.chat.completions.create({
      model,
      messages,
      temperature,
      response_format: { type: 'json_object' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: number }).status
        : 0;
    throw new LlmApiError(message, statusCode);
  }

  // Extract content
  const choice = response.choices?.[0];
  const content = choice?.message?.content?.trim();

  if (!content) {
    throw new LlmApiError('Empty response from DeepSeek API', 0);
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new LlmSchemaError(
      '(root)',
      'valid JSON',
      'unparseable JSON string',
    );
  }

  // Validate against schema
  validateSchema(parsed, schema, model);

  // Token usage
  const usage: TokenUsage = {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
  };

  // Log only token counts — never the full response content
  const cost: CostBreakdown = estimateCost(usage);
  console.log(
    `[DeepSeek] model=${model} ` +
    `prompt_tokens=${usage.promptTokens} ` +
    `completion_tokens=${usage.completionTokens} ` +
    `cost=$${cost.totalCostUsd}`,
  );

  return {
    content,
    model,
    usage,
  };
}

/**
 * Reset the cached client instance (useful for testing).
 */
export function resetClient(): void {
  _client = null;
}

/**
 * Inject a mock client for testing purposes.
 *
 * @param mockClient - A fake or partial OpenAI instance.
 */
export function setMockClient(mockClient: OpenAI): void {
  _client = mockClient;
}
