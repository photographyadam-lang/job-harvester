import { fetchJobs, FetchError } from './stage1-fetch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_TOKEN = 'figma';

/**
 * Minimal shape of a single job as returned by the Greenhouse API.
 */
function createRawJob(overrides: Partial<{ id: number; title: string; content: string; locationName: string; departmentName: string; absoluteUrl: string; updatedAt: string; firstPublished: string }> = {}) {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? 'Software Engineer',
    content: overrides.content ?? '<p>Some job description</p>',
    location: { name: overrides.locationName ?? 'San Francisco, CA' },
    department: { name: overrides.departmentName ?? 'Engineering' },
    absolute_url: overrides.absoluteUrl ?? 'https://boards.greenhouse.io/figma/jobs/1',
    updated_at: overrides.updatedAt ?? '2026-04-16T05:25:34-04:00',
    first_published: overrides.firstPublished ?? '2024-11-01T06:05:10-04:00',
  };
}

/**
 * Mock fetch with a given status and body.
 */
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

describe('fetchJobs', () => {
  test('returns jobs and rawCount for a valid response', async () => {
    const jobs = [createRawJob({ id: 1 }), createRawJob({ id: 2 })];
    mockFetch(200, { jobs });

    const result = await fetchJobs(MOCK_TOKEN);

    expect(result.jobs).toHaveLength(2);
    expect(result.rawCount).toBe(2);
    expect(result.jobs[0].id).toBe(1);
    expect(result.jobs[1].id).toBe(2);
  });

  test('throws FetchError on non-200 HTTP status', async () => {
    mockFetch(404, {});

    const promise = fetchJobs(MOCK_TOKEN);
    await expect(promise).rejects.toThrow(FetchError);
    await expect(promise).rejects.toThrow(
      /Greenhouse API returned status 404/
    );
  });

  test('throws FetchError on invalid JSON body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    } as Response);

    const promise = fetchJobs(MOCK_TOKEN);
    await expect(promise).rejects.toThrow(FetchError);
    await expect(promise).rejects.toThrow(
      /invalid JSON/i
    );
  });

  test('throws FetchError when jobs array is missing', async () => {
    mockFetch(200, {});

    const promise = fetchJobs(MOCK_TOKEN);
    await expect(promise).rejects.toThrow(FetchError);
    await expect(promise).rejects.toThrow(
      /missing.*jobs/i
    );
  });

  test('throws FetchError when jobs array is empty', async () => {
    mockFetch(200, { jobs: [] });

    const promise = fetchJobs(MOCK_TOKEN);
    await expect(promise).rejects.toThrow(FetchError);
    await expect(promise).rejects.toThrow(
      /empty/i
    );
  });

  test('rawCount equals jobs.length', async () => {
    const jobs = [
      createRawJob({ id: 10 }),
      createRawJob({ id: 20 }),
      createRawJob({ id: 30 }),
    ];
    mockFetch(200, { jobs });

    const result = await fetchJobs(MOCK_TOKEN);

    expect(result.rawCount).toBe(result.jobs.length);
    expect(result.rawCount).toBe(3);
  });

  test('extracts updated_at and first_published from the API response', async () => {
    const jobs = [
      createRawJob({
        id: 42,
        updatedAt: '2025-06-15T12:00:00-04:00',
        firstPublished: '2025-03-01T08:30:00-05:00',
      }),
    ];
    mockFetch(200, { jobs });

    const result = await fetchJobs(MOCK_TOKEN);

    expect(result.jobs[0].updated_at).toBe('2025-06-15T12:00:00-04:00');
    expect(result.jobs[0].first_published).toBe('2025-03-01T08:30:00-05:00');
  });

  test('sets updated_at and first_published to undefined when missing from API response', async () => {
    const jobs = [
      {
        id: 99,
        title: 'Minimal Job',
        content: '<p>Minimal</p>',
        location: { name: 'Remote' },
        department: { name: 'Engineering' },
        absolute_url: 'https://example.com/jobs/99',
      },
    ];
    mockFetch(200, { jobs });

    const result = await fetchJobs(MOCK_TOKEN);

    expect(result.jobs[0].updated_at).toBeUndefined();
    expect(result.jobs[0].first_published).toBeUndefined();
  });
});
