/**
 * Tests for config routes, including the suggest-keywords endpoint,
 * CRUD endpoints for company config, and the skills profile endpoint.
 *
 * All tests mock both the Greenhouse fetch layer and the DeepSeek LLM
 * client — no live HTTP requests are made.
 */

import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { LlmApiError } from '../llm/deepseekClient';
import { LlmSchemaError } from '../llm/deepseekClient';
import { FetchError } from '../pipeline/stage1-fetch';
import { fetchJobs } from '../pipeline/stage1-fetch';
import { callDeepSeek } from '../llm/deepseekClient';
import { loadSkillsProfile } from '../config/skillsProfile';
import { ConfigValidationError } from '../config/types';
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

jest.mock('../config/skillsProfile', () => {
  const actual = jest.requireActual<typeof import('../config/skillsProfile')>(
    '../config/skillsProfile',
  );
  return {
    ...actual,
    loadSkillsProfile: jest.fn(),
  };
});

const mockFetchJobs = fetchJobs as jest.Mock;
const mockCallDeepSeek = callDeepSeek as jest.Mock;
const mockLoadSkillsProfile = loadSkillsProfile as jest.Mock;

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
  // Reset loadSkillsProfile to delegate to the real implementation by default.
  // Individual tests may override with mockReturnValue / mockImplementation.
  const actualSkillsProfile = jest.requireActual<
    typeof import('../config/skillsProfile')
  >('../config/skillsProfile');
  mockLoadSkillsProfile.mockImplementation(() =>
    actualSkillsProfile.loadSkillsProfile(),
  );
});

// ---------------------------------------------------------------------------
// Tests: POST /api/config/company/:token/suggest-keywords
// ---------------------------------------------------------------------------

describe('POST /api/config/company/:token/suggest-keywords', () => {
  test('returns roles and specializations from DeepSeek based on fetched job titles', async () => {
    mockFetchJobs.mockResolvedValueOnce({
      jobs: [
        createRawJob({ id: 1, title: 'Manager, Product Design' }),
        createRawJob({ id: 2, title: 'Senior Manager, Product Design' }),
        createRawJob({ id: 3, title: 'Engineer, Data Platform' }),
        createRawJob({ id: 4, title: 'Analyst, Security Operations' }),
      ],
      rawCount: 4,
    });

    mockCallDeepSeek.mockResolvedValueOnce({
      content: JSON.stringify({
        roles: ['Analyst', 'Engineer', 'Manager'],
        specializations: ['Data Platform', 'Product Design', 'Security Operations'],
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
      roles: [
        { name: 'Analyst', count: 1 },
        { name: 'Engineer', count: 1 },
        { name: 'Manager', count: 2 },
      ],
      specializations: [
        { name: 'Data Platform', count: 1 },
        { name: 'Product Design', count: 2 },
        { name: 'Security Operations', count: 1 },
      ],
    });

    // Confirm fetchJobs was called with the token
    expect(mockFetchJobs).toHaveBeenCalledWith('figma');

    // Confirm callDeepSeek received a prompt containing the job titles
    expect(mockCallDeepSeek).toHaveBeenCalledTimes(1);
    const promptArg = mockCallDeepSeek.mock.calls[0][0] as string;
    expect(promptArg).toContain('Manager, Product Design');
    expect(promptArg).toContain('Engineer, Data Platform');
    expect(promptArg).toContain('Analyst, Security Operations');
    // Confirm the prompt instructs two-component decomposition
    expect(promptArg).toContain('ROLES');
    expect(promptArg).toContain('SPECIALIZATIONS');
    expect(promptArg).toContain('deduplicate');
  });

  test('deduplicates identical job titles before sending to DeepSeek', async () => {
    mockFetchJobs.mockResolvedValueOnce({
      jobs: [
        createRawJob({ id: 1, title: 'Manager, Product Design' }),
        createRawJob({ id: 2, title: 'Manager, Product Design' }),
        createRawJob({ id: 3, title: 'Engineer, Data Platform' }),
      ],
      rawCount: 3,
    });

    mockCallDeepSeek.mockResolvedValueOnce({
      content: JSON.stringify({
        roles: ['Engineer', 'Manager'],
        specializations: ['Data Platform', 'Product Design'],
      }),
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
    const designCount = promptArg.split('Manager, Product Design').length - 1;
    expect(designCount).toBe(1);
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
      new LlmSchemaError('roles', 'array of string', 'number'),
    );

    const app = createApp();
    const res = await request(app).post(
      '/api/config/company/figma/suggest-keywords',
    );

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('LLM response validation failed');
  });

  test('returns empty arrays when DeepSeek finds no patterns', async () => {
    mockFetchJobs.mockResolvedValueOnce({
      jobs: [createRawJob({ id: 1, title: 'Job 123' })],
      rawCount: 1,
    });

    mockCallDeepSeek.mockResolvedValueOnce({
      content: JSON.stringify({ roles: [], specializations: [] }),
      model: 'deepseek-chat',
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    const app = createApp();
    const res = await request(app).post(
      '/api/config/company/figma/suggest-keywords',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ roles: [], specializations: [] });
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

// ---------------------------------------------------------------------------
// Tests: POST /api/config/company
// ---------------------------------------------------------------------------

describe('POST /api/config/company', () => {
  const TEST_TOKEN = '__test_company_post__';
  const filePath = path.resolve(
    process.cwd(),
    'config',
    'companies',
    `${TEST_TOKEN}.json`,
  );

  afterEach(() => {
    // Clean up test file
    try {
      fs.unlinkSync(filePath);
    } catch {
      // File may not exist — that's fine
    }
  });

  test('creates a new company with minimal defaults', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/config/company')
      .send({ token: TEST_TOKEN });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe(TEST_TOKEN);
    expect(res.body.departments).toEqual(['Engineering']);
    expect(res.body.boardToken).toBe('');
    expect(res.body.location).toBe('');
    expect(res.body.keyword).toBe('');
    expect(res.body.sectionHeaders).toEqual({
      must_have: ["We'd love to hear from you if you have:"],
      nice_to_have: ["While it's not required, it's an added plus if you also have:"],
    });
  });

  test('creates a new company with custom config', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/config/company')
      .send({
        token: TEST_TOKEN,
        config: {
          name: 'Acme Corp',
          departments: ['Sales', 'Marketing'],
          boardToken: 'acme-greenhouse',
          location: 'Remote',
          keyword: 'Sales',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Acme Corp');
    expect(res.body.departments).toEqual(['Sales', 'Marketing']);
    expect(res.body.boardToken).toBe('acme-greenhouse');
    expect(res.body.location).toBe('Remote');
    expect(res.body.keyword).toBe('Sales');
  });

  test('returns 409 when company already exists', async () => {
    const app = createApp();

    // First create
    await request(app)
      .post('/api/config/company')
      .send({ token: TEST_TOKEN });

    // Second create should fail
    const res = await request(app)
      .post('/api/config/company')
      .send({ token: TEST_TOKEN });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Company already exists');
  });

  test('returns 400 when token is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/config/company')
      .send({ config: { name: 'Test' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.detail).toContain('token');
  });

  test('returns 400 when token is empty string', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/config/company')
      .send({ token: '  ', config: { name: 'Test' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  test('returns 400 when config has validation errors (empty departments)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/config/company')
      .send({
        token: TEST_TOKEN,
        config: { departments: [] },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

// ---------------------------------------------------------------------------
// Tests: DELETE /api/config/company/:token
// ---------------------------------------------------------------------------

describe('DELETE /api/config/company/:token', () => {
  const TEST_TOKEN = '__test_company_delete__';
  const filePath = path.resolve(
    process.cwd(),
    'config',
    'companies',
    `${TEST_TOKEN}.json`,
  );

  afterEach(() => {
    // Clean up test file
    try {
      fs.unlinkSync(filePath);
    } catch {
      // File may not exist — that's fine
    }
  });

  test('deletes an existing company', async () => {
    const app = createApp();

    // Create first
    await request(app)
      .post('/api/config/company')
      .send({ token: TEST_TOKEN });

    // Delete
    const res = await request(app).delete(
      `/api/config/company/${TEST_TOKEN}`,
    );

    expect(res.status).toBe(204);
  });

  test('returns 404 when company does not exist', async () => {
    const app = createApp();
    const res = await request(app).delete(
      '/api/config/company/nonexistent-company-xyz',
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Company not found');
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/config/company/:token
// ---------------------------------------------------------------------------

describe('GET /api/config/company/:token', () => {
  test('returns 200 with company config when token exists', async () => {
    const app = createApp();
    const res = await request(app).get('/api/config/company/figma');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Figma');
    expect(res.body.departments).toBeInstanceOf(Array);
    expect(res.body.departments.length).toBeGreaterThan(0);
    expect(res.body.sectionHeaders).toBeDefined();
    expect(res.body.sectionHeaders.must_have).toBeInstanceOf(Array);
  });

  test('returns 400 when token not found', async () => {
    const app = createApp();
    const res = await request(app).get(
      '/api/config/company/nonexistent-token-xyz-999',
    );

    // loadCompanyConfig throws ConfigValidationError →
    // handleValidationError returns 400
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.detail).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// Tests: PUT /api/config/company/:token
// ---------------------------------------------------------------------------

describe('PUT /api/config/company/:token', () => {
  const TEST_TOKEN = '__test_company_put__';
  const filePath = path.resolve(
    process.cwd(),
    'config',
    'companies',
    `${TEST_TOKEN}.json`,
  );

  afterEach(() => {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // File may not exist — that's fine
    }
  });

  test('updates existing company config and returns 200', async () => {
    const app = createApp();

    // Create a company first
    await request(app).post('/api/config/company').send({ token: TEST_TOKEN });

    // Update it
    const res = await request(app)
      .put(`/api/config/company/${TEST_TOKEN}`)
      .send({
        name: 'Updated Corp',
        departments: ['Engineering', 'Design'],
        location: 'Remote',
        keyword: 'Engineer',
        boardToken: 'updated-board',
        sectionHeaders: {
          must_have: ['You have:'],
          nice_to_have: ['Bonus:'],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Corp');
    expect(res.body.departments).toEqual(['Engineering', 'Design']);
    expect(res.body.keyword).toBe('Engineer');
  });

  test('returns 400 on invalid config body', async () => {
    const app = createApp();

    const res = await request(app)
      .put(`/api/config/company/${TEST_TOKEN}`)
      .send({ invalid: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  test('creates a new company via PUT when token does not exist', async () => {
    const app = createApp();

    const res = await request(app)
      .put(`/api/config/company/${TEST_TOKEN}`)
      .send({
        name: 'New Put Corp',
        departments: ['Product'],
        sectionHeaders: {
          must_have: ["We'd love to hear from you if you have:"],
          nice_to_have: [
            "While it's not required, it's an added plus if you also have:",
          ],
        },
      });

    // PUT writes the file regardless of prior existence; validation passes
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Put Corp');
    expect(res.body.departments).toEqual(['Product']);
  });
});

// ---------------------------------------------------------------------------
// Tests: PUT /api/config/profile
// ---------------------------------------------------------------------------

describe('PUT /api/config/profile', () => {
  beforeEach(() => {
    // Prevent real file operations on the profile file (profile/adam.json).
    // The route writes to disk, but we intercept fs calls so the real file
    // is never touched.
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    jest.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        skills: [{ name: 'Existing', strength: 'must_have' as const }],
        gapThreshold: 0.5,
      }),
    );
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('updates skills profile and returns 200', async () => {
    const updatedProfile = {
      skills: [
        { name: 'TypeScript', strength: 'must_have' as const },
        { name: 'Python', strength: 'nice_to_have' as const },
      ],
      gapThreshold: 0.6,
    };

    mockLoadSkillsProfile.mockReturnValue(updatedProfile);

    const app = createApp();
    const res = await request(app)
      .put('/api/config/profile')
      .send(updatedProfile);

    expect(res.status).toBe(200);
    expect(res.body.gapThreshold).toBe(0.6);
    expect(res.body.skills).toHaveLength(2);
    expect(res.body.skills[0].name).toBe('TypeScript');
  });

  test('returns 400 on invalid profile', async () => {
    // First call (validation) throws; backup restoration is a no-op
    // because fs.writeFileSync is mocked.
    mockLoadSkillsProfile.mockImplementation(() => {
      throw new ConfigValidationError(
        'Field "skills" must be an array in skills profile',
      );
    });

    const app = createApp();
    const res = await request(app)
      .put('/api/config/profile')
      .send({ skills: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.detail).toContain('must be an array');
  });
});
