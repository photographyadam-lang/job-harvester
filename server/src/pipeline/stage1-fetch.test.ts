import { fetchJobs, FetchError } from './stage1-fetch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_TOKEN = 'figma';

/**
 * Minimal shape of a single job as returned by the Greenhouse API.
 */
function createRawJob(overrides: Partial<{ id: number; title: string; content: string; locationName: string; departmentName: string; absoluteUrl: string }> = {}) {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? 'Software Engineer',
    content: overrides.content ?? '<p>Some job description</p>',
    location: { name: overrides.locationName ?? 'San Francisco, CA' },
    department: { name: overrides.departmentName ?? 'Engineering' },
    absolute_url: overrides.absoluteUrl ?? 'https://boards.greenhouse.io/figma/jobs/1',
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
});
