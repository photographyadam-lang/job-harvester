/**
 * Stage 1 — Fetch
 *
 * Fetches the Greenhouse job catalog for a given company token and returns the
 * raw jobs array along with a count of jobs received from the API.
 *
 * All Greenhouse HTTP logic is isolated in this module.
 */

import { RawJob } from '../types';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Custom error thrown when the Greenhouse API returns an unexpected response.
 */
export class FetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchError';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Result returned by {@link fetchJobs}.
 */
export interface FetchResult {
  jobs: RawJob[];
  rawCount: number;
}

/**
 * Fetch the Greenhouse job catalog for the given company `token`.
 *
 * @param token - Greenhouse company board token (e.g. `"figma"`).
 * @returns An object containing the raw jobs array and a count of jobs.
 * @throws {FetchError} On non-200 status, invalid JSON, missing or empty `jobs` array.
 */
export async function fetchJobs(token: string): Promise<FetchResult> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new FetchError(
      `Network request to Greenhouse API failed: ${(err as Error).message}`
    );
  }

  if (!response.ok) {
    throw new FetchError(
      `Greenhouse API returned status ${response.status} for token "${token}"`
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await response.json();
  } catch {
    throw new FetchError(
      `Received invalid JSON from Greenhouse API for token "${token}"`
    );
  }

  if (!Array.isArray(body.jobs)) {
    throw new FetchError(
      `Greenhouse API response is missing the "jobs" array for token "${token}"`
    );
  }

  if (body.jobs.length === 0) {
    throw new FetchError(
      `Greenhouse API returned an empty jobs array for token "${token}"`
    );
  }

  // Normalize the Greenhouse API response shape to the RawJob type.
  // The live API returns `departments` (plural, an array) but the pipeline
  // expects `department` (singular, an object with `name`).  Test fixtures
  // may already supply `department` directly – handle both shapes.
  const jobs: RawJob[] = (body.jobs as Record<string, unknown>[]).map(
    (raw): RawJob => {
      // --- department ---
      let departmentName = 'Unknown';

      // Already-normalized shape (tests)
      if (
        raw.department != null &&
        typeof raw.department === 'object' &&
        typeof (raw.department as Record<string, unknown>).name === 'string'
      ) {
        departmentName = (raw.department as Record<string, unknown>)
          .name as string;
      } else if (Array.isArray(raw.departments) && raw.departments.length > 0) {
        // Live API shape: `departments` (plural array)
        const first =
          typeof raw.departments[0] === 'object' && raw.departments[0] !== null
            ? (raw.departments[0] as Record<string, unknown>)
            : null;
        if (first && typeof first.name === 'string') {
          departmentName = first.name;
        }
      }

      // --- location ---
      let locationName = 'Unknown';
      if (
        raw.location != null &&
        typeof raw.location === 'object' &&
        typeof (raw.location as Record<string, unknown>).name === 'string'
      ) {
        locationName = (raw.location as Record<string, unknown>)
          .name as string;
      }

      return {
        id: typeof raw.id === 'number' ? raw.id : 0,
        title: typeof raw.title === 'string' ? raw.title : 'Untitled',
        content: typeof raw.content === 'string' ? raw.content : '',
        location: { name: locationName },
        department: { name: departmentName },
        absolute_url:
          typeof raw.absolute_url === 'string' ? raw.absolute_url : '',
      };
    },
  );

  return {
    jobs,
    rawCount: jobs.length,
  };
}
