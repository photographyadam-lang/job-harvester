/**
 * Tests for config routes, including the suggest-keywords endpoint.
 *
 * All tests mock both the Greenhouse fetch layer and the DeepSeek LLM
 * client — no live HTTP requests are made.
 */

import express from 'express';
import request from 'supertest';
import { LlmApiError } from '../llm/deepseekClient';
import { LlmSchemaError } from '../llm/deepseekClient';
import { FetchError } from '../pipeline/stage1-fetch';
import { fetchJobs } from '../pipeline/stage1-fetch';
import { callDeepSeek } from '../llm/deepseekClient';
import configRoutes from './config';

// ---------------------------------------------------------------------------
// Mocks — jest.mock calls are hoisted; factories use jest.requireActual
// to keep error classes real so instanceof checks work in the route.
// ---------------------------------------------------------------------------

jest.mock('../pipeline/stage1-fetch', () => {
  const actual = jest.requireActual<typeof import('../pipeline/stage1-fetch')>(
    '../pipeline/stage1-fetch',
  );
  return {
    ...actual,
    fetchJobs: jest.fn(),
  };
});

jest.mock('../llm/deepseekClient', () => {
  const actual = jest.requireActual<typeof import('../llm/deepseekClient')>(
    '../llm/deepseekClient',
  );
  return {
    ...actual,
    callDeepSeek: jest.fn(),
  };
});

const mockFetchJobs = fetchJobs as jest.Mock;
const mockCallDeepSeek = callDeepSeek as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api', configRoutes);
  return app;
}

function createRawJob(overrides: {
  id?: number;
  title?: string;
  content?: string;
  locationName?: string;
  departmentName?: string;
  absoluteUrl?: string;
} = {}) {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? 'Software Engineer',
    content: overrides.content ?? '<p>Some job description</p>',
    location: { name: overrides.locationName ?? 'San Francisco, CA' },
    department: { name: overrides.departmentName ?? 'Engineering' },
    absolute_url:
      overrides.absoluteUrl ?? 'https://boards.greenhouse.io/figma/jobs/1',
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests: POST /api/config/company/:token/suggest-keywords
// ---------------------------------------------------------------------------

describe('POST /api/config/company/:token/suggest-keywords', () => {
  test('returns keywords from DeepSeek based on fetched job titles', async () => {
    mockFetchJobs.mockResolvedValueOnce({
      jobs: [
        createRawJob({ id: 1, title: 'Software Engineer' }),
        createRawJob({ id: 2, title: 'Senior Software Engineer' }),
        createRawJob({ id: 3, title: 'Product Designer' }),
        createRawJob({ id: 4, title: 'Engineering Manager' }),
      ],
      rawCount: 4,
    });

    mockCallDeepSeek.mockResolvedValueOnce({
      content: JSON.stringify({
        keywords: ['Engineer', 'Designer', 'Manager'],
      }),
      model: 'deepseek-chat',
      usage: { promptTokens: 50, completionTokens: 20 },
    });

    const app = createApp();
    const res = await request(app).post(
      '/api/config/company/figma/suggest-keywords',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      keywords: ['Engineer', 'Designer', 'Manager'],
    });

    // Confirm fetchJobs was called with the token
    expect(mockFetchJobs).toHaveBeenCalledWith('figma');

    // Confirm callDeepSeek received a prompt containing the job titles
    expect(mockCallDeepSeek).toHaveBeenCalledTimes(1);
    const promptArg = mockCallDeepSeek.mock.calls[0][0] as string;
    expect(promptArg).toContain('Software Engineer');
    expect(promptArg).toContain('Product Designer');
    expect(promptArg).toContain('Engineering Manager');
  });

  test('deduplicates identical job titles before sending to DeepSeek', async () => {
    mockFetchJobs.mockResolvedValueOnce({
      jobs: [
        createRawJob({ id: 1, title: 'Software Engineer' }),
        createRawJob({ id: 2, title: 'Software Engineer' }),
        createRawJob({ id: 3, title: 'Product Designer' }),
      ],
      rawCount: 3,
    });

    mockCallDeepSeek.mockResolvedValueOnce({
      content: JSON.stringify({ keywords: ['Engineer', 'Designer'] }),
      model: 'deepseek-chat',
      usage: { promptTokens: 30, completionTokens: 15 },
    });

    const app = createApp();
    const res = await request(app).post(
      '/api/config/company/figma/suggest-keywords',
    );

    expect(res.status).toBe(200);
    // Titles should appear only once in the prompt
    const promptArg = mockCallDeepSeek.mock.calls[0][0] as string;
    const engineerCount = promptArg.split('Software Engineer').length - 1;
    expect(engineerCount).toBe(1);
  });

  test('returns 502 when Greenhouse API fails', async () => {
    mockFetchJobs.mockRejectedValueOnce(
      new FetchError(
        'Greenhouse API returned status 404 for token "bad-token"',
      ),
    );

    const app = createApp();
    const res = await request(app).post(
      '/api/config/company/bad-token/suggest-keywords',
    );

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Greenhouse API error');
    expect(res.body.detail).toContain('404');
  });

  test('returns 502 when DeepSeek API fails', async () => {
    mockFetchJobs.mockResolvedValueOnce({
      jobs: [createRawJob({ id: 1, title: 'Software Engineer' })],
      rawCount: 1,
    });

    mockCallDeepSeek.mockRejectedValueOnce(
      new LlmApiError('DeepSeek API rate limit exceeded', 429),
    );

    const app = createApp();
    const res = await request(app).post(
      '/api/config/company/figma/suggest-keywords',
    );

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('LLM API error');
    expect(res.body.detail).toContain('rate limit');
  });

  test('returns 502 when DeepSeek response fails schema validation', async () => {
    mockFetchJobs.mockResolvedValueOnce({
      jobs: [createRawJob({ id: 1, title: 'Software Engineer' })],
      rawCount: 1,
    });

    mockCallDeepSeek.mockRejectedValueOnce(
      new LlmSchemaError('keywords', 'array of string', 'number'),
    );

    const app = createApp();
    const res = await request(app).post(
      '/api/config/company/figma/suggest-keywords',
    );

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('LLM response validation failed');
  });

  test('returns empty keywords array when DeepSeek finds no patterns', async () => {
    mockFetchJobs.mockResolvedValueOnce({
      jobs: [createRawJob({ id: 1, title: 'Job 123' })],
      rawCount: 1,
    });

    mockCallDeepSeek.mockResolvedValueOnce({
      content: JSON.stringify({ keywords: [] }),
      model: 'deepseek-chat',
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    const app = createApp();
    const res = await request(app).post(
      '/api/config/company/figma/suggest-keywords',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ keywords: [] });
  });

  test('returns 500 for unexpected errors', async () => {
    mockFetchJobs.mockResolvedValueOnce({
      jobs: [createRawJob({ id: 1, title: 'Software Engineer' })],
      rawCount: 1,
    });

    mockCallDeepSeek.mockRejectedValueOnce(new Error('Something unexpected'));

    const app = createApp();
    const res = await request(app).post(
      '/api/config/company/figma/suggest-keywords',
    );

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});
