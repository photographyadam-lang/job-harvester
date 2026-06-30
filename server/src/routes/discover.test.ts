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
      locations: [
        { name: 'Berlin, Germany', count: 1 },
        { name: 'London, UK', count: 1 },
        { name: 'San Francisco, CA', count: 2 },
      ],
      departments: [
        { name: 'Engineering', count: 2 },
        { name: 'Marketing', count: 1 },
        { name: 'Sales', count: 1 },
      ],
    });
  });

  test('splits multi-location strings separated by semicolons or pipes', async () => {
    const jobs = [
      createRawJob({
        id: 1,
        locationName:
          'Austin, TX; Remote - US; London, UK',
        departmentName: 'Engineering',
      }),
      createRawJob({
        id: 2,
        locationName: 'Berlin, Germany',
        departmentName: 'Sales',
      }),
    ];
    mockFetch(200, { jobs });

    const app = createApp();
    const res = await request(app).get('/api/discover/figma');

    expect(res.status).toBe(200);
    expect(res.body.locations).toEqual([
      { name: 'Austin, TX', count: 1 },
      { name: 'Berlin, Germany', count: 1 },
      { name: 'London, UK', count: 1 },
      { name: 'Remote - US', count: 1 },
    ]);
    expect(res.body.departments).toEqual([
      { name: 'Engineering', count: 1 },
      { name: 'Sales', count: 1 },
    ]);
  });

  test('splits pipe-delimited multi-location strings into individual entries', async () => {
    const jobs = [
      createRawJob({
        id: 1,
        locationName:
          'San Francisco, CA | New York City, NY | Seattle, WA',
        departmentName: 'Engineering',
      }),
      createRawJob({
        id: 2,
        locationName: 'London, UK | Paris, France',
        departmentName: 'Engineering',
      }),
      createRawJob({
        id: 3,
        locationName: 'San Francisco, CA',
        departmentName: 'Sales',
      }),
    ];
    mockFetch(200, { jobs });

    const app = createApp();
    const res = await request(app).get('/api/discover/figma');

    expect(res.status).toBe(200);
    expect(res.body.locations).toEqual([
      { name: 'London, UK', count: 1 },
      { name: 'New York City, NY', count: 1 },
      { name: 'Paris, France', count: 1 },
      { name: 'San Francisco, CA', count: 2 },
      { name: 'Seattle, WA', count: 1 },
    ]);
    expect(res.body.departments).toEqual([
      { name: 'Engineering', count: 2 },
      { name: 'Sales', count: 1 },
    ]);
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
    expect(res.body.locations).toEqual([{ name: 'Berlin, Germany', count: 1 }]);
    expect(res.body.departments).toEqual([{ name: 'Sales', count: 1 }]);
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
