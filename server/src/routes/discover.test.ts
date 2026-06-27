/**
 * Tests for GET /api/discover/:token
 *
 * All tests use mocked `fetch` — no live Greenhouse HTTP requests.
 */

import express from 'express';
import request from 'supertest';
import discoverRoutes from './discover';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createApp(): express.Application {
  const app = express();
  app.use('/api', discoverRoutes);
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

function mockFetch(status: number, body: unknown) {
  return jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/discover/:token', () => {
  test('returns sorted unique locations and departments', async () => {
    const jobs = [
      createRawJob({ id: 1, locationName: 'San Francisco, CA', departmentName: 'Engineering' }),
      createRawJob({ id: 2, locationName: 'Berlin, Germany', departmentName: 'Sales' }),
      createRawJob({ id: 3, locationName: 'San Francisco, CA', departmentName: 'Engineering' }),
      createRawJob({ id: 4, locationName: 'London, UK', departmentName: 'Marketing' }),
    ];
    mockFetch(200, { jobs });

    const app = createApp();
    const res = await request(app).get('/api/discover/figma');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      locations: ['Berlin, Germany', 'London, UK', 'San Francisco, CA'],
      departments: ['Engineering', 'Marketing', 'Sales'],
    });
  });

  test('filters out "Unknown" location and department values', async () => {
    const jobs = [
      createRawJob({ id: 1, locationName: 'Unknown', departmentName: 'Unknown' }),
      createRawJob({ id: 2, locationName: 'Berlin, Germany', departmentName: 'Sales' }),
    ];
    mockFetch(200, { jobs });

    const app = createApp();
    const res = await request(app).get('/api/discover/figma');

    expect(res.status).toBe(200);
    expect(res.body.locations).toEqual(['Berlin, Germany']);
    expect(res.body.departments).toEqual(['Sales']);
  });

  test('returns 502 when Greenhouse API fails', async () => {
    mockFetch(404, {});

    const app = createApp();
    const res = await request(app).get('/api/discover/bad-token');

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Greenhouse API error');
    expect(res.body.detail).toContain('404');
  });

  test('returns 502 on network error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const app = createApp();
    const res = await request(app).get('/api/discover/figma');

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Greenhouse API error');
    expect(res.body.detail).toContain('ECONNREFUSED');
  });
});
