/**
 * DeepSeek Client tests
 *
 * @jest-environment node
 */

import OpenAI from 'openai';
import {
  callDeepSeek,
  LlmApiError,
  LlmSchemaError,
  setMockClient,
  resetClient,
} from './deepseekClient';
import { extractionSchema } from './schemaValidator';

// ---------------------------------------------------------------------------
// Mock openai module so we can spy on the OpenAI constructor without making
// live HTTP requests (Rule 8).  jest.mock without a factory auto-mocks the
// module; we configure the mockConstructor / mockCreate behaviour in
// beforeEach so every test starts fresh.
// ---------------------------------------------------------------------------

jest.mock('openai');

/** Reference to the mocked OpenAI constructor (default export). */
const MockedOpenAI = OpenAI as unknown as jest.Mock;

/**
 * Convenience accessor for the `chat.completions.create` mock on the most
 * recently constructed OpenAI instance.  Set up by beforeEach.
 */
let mockOpenAICreate: jest.Mock;

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock OpenAI client that returns a given response shape.
 *
 * The `chat.completions.create` method is mocked to resolve with the provided
 * partial `ChatCompletion` object.
 */
function createMockClient(
  overrides: Partial<OpenAI.Chat.ChatCompletion> = {},
): OpenAI {
  const defaultResponse: OpenAI.Chat.ChatCompletion = {
    id: 'mock-completion-id',
    object: 'chat.completion',
    created: 1_000_000_000,
    model: 'deepseek-chat',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '{"must_haves":["React"],"nice_to_haves":[]}',
          refusal: null,
        },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  };

  const merged = {
    ...defaultResponse,
    ...overrides,
    choices: overrides.choices ?? defaultResponse.choices,
  };

  const mockCreate = jest.fn<Promise<OpenAI.Chat.ChatCompletion>, []>();
  mockCreate.mockResolvedValue(merged);

  return {
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  } as unknown as OpenAI;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

/** Snapshot of DEEPSEEK_API_KEY at load time so we can restore it. */
const originalApiKey = process.env.DEEPSEEK_API_KEY;

beforeEach(() => {
  resetClient();
  MockedOpenAI.mockClear();

  // Build a fresh mockCreate for each test so call assertions are isolated.
  mockOpenAICreate = jest.fn().mockResolvedValue({
    id: 'mock-completion',
    object: 'chat.completion',
    created: 1_000_000_000,
    model: 'deepseek-chat',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '{"must_haves":["React"],"nice_to_haves":[]}',
          refusal: null,
        },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });

  // Configure the auto-mocked OpenAI constructor to return a fake client
  // whose `chat.completions.create` delegates to `mockOpenAICreate`.
  MockedOpenAI.mockImplementation(() => ({
    chat: { completions: { create: mockOpenAICreate } },
  }));
});

afterEach(() => {
  jest.useRealTimers();
  // Restore the real API key so downstream tests aren't poisoned.
  process.env.DEEPSEEK_API_KEY = originalApiKey;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('callDeepSeek', () => {
  // 1. Valid response returns LlmResponse
  test('valid response returns LlmResponse', async () => {
    const mockClient = createMockClient();
    setMockClient(mockClient);

    const result = await callDeepSeek(
      'Extract requirements from this job',
      extractionSchema,
    );

    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('model', 'deepseek-chat');
    expect(result).toHaveProperty('usage');
    expect(result.usage).toHaveProperty('promptTokens', 10);
    expect(result.usage).toHaveProperty('completionTokens', 20);
  });

  // 2. API failure throws LlmApiError
  test('API failure throws LlmApiError', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: jest
            .fn<Promise<never>, []>()
            .mockRejectedValue(new Error('Network error')),
        },
      },
    } as unknown as OpenAI;
    setMockClient(mockClient);

    await expect(
      callDeepSeek('Extract requirements', extractionSchema),
    ).rejects.toThrow(LlmApiError);
  });

  // 3. Schema violation throws LlmSchemaError
  test('schema violation throws LlmSchemaError', async () => {
    const mockClient = createMockClient({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '{"must_haves":"not_an_array","nice_to_haves":[]}',
            refusal: null,
          },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
    });
    setMockClient(mockClient);

    await expect(
      callDeepSeek('Extract requirements', extractionSchema),
    ).rejects.toThrow(LlmSchemaError);
  });

  // 4. Rate limiter enforces ≥1500ms delay between calls
  test('rate limiter enforces ≥1500ms delay between calls', async () => {
    jest.useFakeTimers({ advanceTimers: true });

    // Create a mock that resolves immediately
    const mockClient = createMockClient();
    setMockClient(mockClient);

    // Manually install a promise-based delay so we can control timers
    // Call DeepSeek twice — the first call should start immediately,
    // the second should be delayed by at least 1500ms

    // We'll skip jest fake timers for actual timing measurement
    // and instead verify the rate limiter behaviour with real timers
    jest.useRealTimers();

    const start = Date.now();
    await callDeepSeek('First call', extractionSchema);
    await callDeepSeek('Second call', extractionSchema);
    const elapsed = Date.now() - start;

    // Two calls with a 1500ms delay means total should be >= 1500ms
    expect(elapsed).toBeGreaterThanOrEqual(1500);
  }, 10_000); // 10s timeout for this slow test
});

// ---------------------------------------------------------------------------
// API key handling — tests that prevent regression of the dotenv / cwd issue
// ---------------------------------------------------------------------------

describe('API key handling', () => {
  // These tests call callDeepSeek without setMockClient so that createClient
  // runs and reads process.env.DEEPSEEK_API_KEY.  The openai module is mocked
  // at the top of this file so no real HTTP request is ever made (Rule 8).

  // -----------------------------------------------------------------------
  // 5. Missing API key throws LlmApiError with specific message
  // -----------------------------------------------------------------------
  test('throws LlmApiError when DEEPSEEK_API_KEY is not set', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    resetClient();

    const errPromise = callDeepSeek('test prompt', extractionSchema);

    await expect(errPromise).rejects.toThrow(LlmApiError);
    await expect(errPromise).rejects.toThrow(
      'DEEPSEEK_API_KEY is not set in environment variables',
    );

    // Verify the error has statusCode 0 (not an HTTP error)
    try {
      await errPromise;
    } catch (err) {
      expect(err).toBeInstanceOf(LlmApiError);
      expect((err as LlmApiError).statusCode).toBe(0);
    }
  });

  // -----------------------------------------------------------------------
  // 6. API key is forwarded to the OpenAI constructor when set
  // -----------------------------------------------------------------------
  test('passes DEEPSEEK_API_KEY to OpenAI constructor when set', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-mock-key-12345';
    resetClient();

    await callDeepSeek('Extract requirements', extractionSchema);

    // The mocked OpenAI constructor should have been called with the API key
    expect(MockedOpenAI).toHaveBeenCalledTimes(1);
    expect(MockedOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test-mock-key-12345',
        baseURL: 'https://api.deepseek.com',
      }),
    );
  });

});
