/**
 * Stage 2 — Metadata Filter
 *
 * Applies three sequential filters (location, department, role-name keyword)
 * to a list of raw jobs fetched from the Greenhouse API and returns only those
 * that pass all three filters, along with a list of rejected jobs.
 *
 * This module is pure: no I/O, no network, no side effects.
 */

import type { RawJob, FilterConfig, FilteredJob, StageResult, RejectedJob } from '../types';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Custom error thrown when zero jobs survive all three metadata filters.
 */
export class ConfigMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigMismatchError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a RawJob (from the Greenhouse API shape) to a FilteredJob (flat shape).
 */
function toFilteredJob(job: RawJob): FilteredJob {
  return {
    id: job.id,
    title: job.title,
    content: job.content,
    location: job.location.name,
    department: job.department.name,
    url: job.absolute_url,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply three sequential metadata filters (location, department, keyword) to
 * an array of raw jobs.
 *
 * Filters are applied in order: location first, then department, then keyword.
 * A job is rejected at the first filter it fails, and its `reason` string
 * identifies which filter rejected it and which field value caused the rejection.
 *
 * @param jobs  - Raw jobs from Stage 1.
 * @param config - Filter configuration (location, departments, keyword).
 * @returns An object with `passed` (FilteredJob[]) and `rejected` (RejectedJob[]).
 * @throws {ConfigMismatchError} When zero jobs survive all three filters.
 */
export function filterJobs(
  jobs: RawJob[],
  config: FilterConfig,
): StageResult<FilteredJob> {
  const rejected: RejectedJob[] = [];
  const passed: FilteredJob[] = [];

  for (const job of jobs) {
    // --- Filter 1: Location (case-insensitive substring) ---
    if (config.location.length > 0) {
      const jobLocation = job.location.name.toLowerCase();
      const targetLocation = config.location.toLowerCase();
      if (!jobLocation.includes(targetLocation)) {
        rejected.push({
          id: job.id,
          title: job.title,
          url: job.absolute_url,
          rejectedAtStage: 2,
          reason: `Rejected by location filter: "${job.location.name}" does not match "${config.location}"`,
        });
        continue;
      }
    }

    // --- Filter 2: Department (case-insensitive exact match) ---
    if (config.departments.length > 0) {
      const jobDepartment = job.department.name.toLowerCase();
      const matchesDepartment = config.departments.some(
        (d) => d.toLowerCase() === jobDepartment,
      );
      if (!matchesDepartment) {
        rejected.push({
          id: job.id,
          title: job.title,
          url: job.absolute_url,
          rejectedAtStage: 2,
          reason: `Rejected by department filter: "${job.department.name}" is not in [${config.departments.join(', ')}]`,
        });
        continue;
      }
    }

    // --- Filter 3: Keyword (case-insensitive substring on title, OR logic) ---
    if (config.keyword.length > 0) {
      const keywords = config.keyword
        .split(',')
        .map((kw) => kw.trim().toLowerCase())
        .filter((kw) => kw.length > 0);

      if (keywords.length > 0) {
        const jobTitle = job.title.toLowerCase();
        const matchesAny = keywords.some((kw) => jobTitle.includes(kw));

        if (!matchesAny) {
          rejected.push({
            id: job.id,
            title: job.title,
            url: job.absolute_url,
            rejectedAtStage: 2,
            reason: `Rejected by keyword filter: "${job.title}" does not match any keyword in [${config.keyword}]`,
          });
          continue;
        }
      }
    }

    // Job passed all three filters
    passed.push(toFilteredJob(job));
  }

  if (passed.length === 0) {
    throw new ConfigMismatchError(
      'Zero jobs survived Stage 2 (metadata filter). Check your filter config (location, departments, keyword).',
    );
  }

  return { passed, rejected };
}
