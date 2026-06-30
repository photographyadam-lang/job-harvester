/**
 * Stage 2 — Metadata Filter
 *
 * Applies a two-phase filter to raw Greenhouse jobs:
 *
 *   Phase 1 — Location: case-insensitive substring OR match on
 *     `job.location.name`.  Jobs in locations the user cannot work from
 *     are rejected first.
 *
 *   Phase 2 — (Role Keyword AND Departments) OR (Description Keyword):
 *     A job passes if EITHER its title matches a keyword AND its department
 *     is in the allowed list (Branch A), OR its raw content/description
 *     contains a description keyword (Branch B).  This lets you set tight
 *     role+department constraints while still catching relevant jobs that
 *     live in unexpected departments.
 *
 * This module is pure: no I/O, no network, no side effects.
 */

import type { RawJob, FilterConfig, FilteredJob, StageResult, RejectedJob } from '../types';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Custom error thrown when zero jobs survive both filter phases.
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
function toFilteredJob(job: RawJob, matchReason: string): FilteredJob {
  return {
    id: job.id,
    title: job.title,
    content: job.content,
    location: job.location.name,
    department: job.department.name,
    url: job.absolute_url,
    matchReason,
  };
}

/**
 * Split a comma-separated config string into trimmed, lowercased,
 * non-empty keyword tokens.
 */
function parseKeywordTokens(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply two-phase metadata filtering to an array of raw jobs.
 *
 * Phase 1 — Location: case-insensitive substring OR match on
 *   `job.location.name`.  Pipe-delimited segments are split so each
 *   location option is checked independently.
 *
 * Phase 2 — (Role Keyword AND Departments) OR (Description Keyword):
 *   - Branch A: the job title must contain at least one keyword AND the
 *     job department must be in the configured list.  Disabled when
 *     `keyword` or `departments` is empty.
 *   - Branch B: the job content (raw HTML description) must contain at
 *     least one description keyword.  Disabled when `descriptionKeyword`
 *     is empty.
 *   - When no Phase 2 filters are configured at all, all jobs pass.
 *
 * @param jobs   - Raw jobs from Stage 1.
 * @param config - Filter configuration (location, departments, keyword,
 *                 descriptionKeyword).
 * @returns An object with `passed` (FilteredJob[]) and `rejected` (RejectedJob[]).
 * @throws {ConfigMismatchError} When zero jobs survive both phases.
 */
export function filterJobs(
  jobs: RawJob[],
  config: FilterConfig,
): StageResult<FilteredJob> {
  const rejected: RejectedJob[] = [];
  const passed: FilteredJob[] = [];

  // Pre-compute Phase 2 flags once (they don't change per job)
  const hasKeyword = config.keyword.trim().length > 0;
  const hasDepartments = config.departments.length > 0;
  const hasDescKeyword = config.descriptionKeyword.trim().length > 0;
  const phase2Configured = hasKeyword || hasDepartments || hasDescKeyword;

  // Pre-parse keyword tokens for Branch A
  const keywordTokens = hasKeyword
    ? parseKeywordTokens(config.keyword)
    : [];

  // Pre-parse description keyword tokens for Branch B
  const descKeywordTokens = hasDescKeyword
    ? parseKeywordTokens(config.descriptionKeyword)
    : [];

  for (const job of jobs) {
    // -----------------------------------------------------------------------
    // Phase 1: Location (comma-separated, case-insensitive OR match)
    // -----------------------------------------------------------------------
    // Pipe-delimited location strings (e.g. "San Francisco, CA | Seattle, WA")
    // are split into individual segments so each location is checked separately.
    let locationMatched = '';
    if (config.location.length > 0) {
      const locations = config.location
        .split(',')
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l.length > 0);

      if (locations.length > 0) {
        const jobLocationSegments = job.location.name
          .split('|')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0);
        const matchingLoc = locations.find((loc) =>
          jobLocationSegments.some((segment) => segment.includes(loc)),
        );
        if (!matchingLoc) {
          rejected.push({
            id: job.id,
            title: job.title,
            url: job.absolute_url,
            rejectedAtStage: 2,
            reason: `Rejected by location filter: "${job.location.name}" does not match any location in [${config.location}]`,
          });
          continue;
        }
        locationMatched = matchingLoc;
      }
    }

    // -----------------------------------------------------------------------
    // Phase 2: (Role Keyword AND Departments) OR (Description Keyword)
    // -----------------------------------------------------------------------
    let phase2Reason = '';
    if (phase2Configured) {
      let phase2Passes = false;

      // Branch A: Role Keyword AND Departments
      if (hasKeyword && hasDepartments) {
        const jobTitle = job.title.toLowerCase();
        const matchedKeyword = keywordTokens.find((kw) =>
          jobTitle.includes(kw),
        );

        const jobDept = job.department.name.trim().toLowerCase();
        const deptMatch = config.departments.some(
          (d) => d.toLowerCase() === jobDept,
        );

        if (matchedKeyword && deptMatch) {
          phase2Passes = true;
          phase2Reason = `Role+Dept match: title "${job.title}" matched keyword "${matchedKeyword}" in department "${job.department.name}"`;
        }
      }

      // Branch B: Description Keyword (OR — can save a job that failed Branch A)
      if (!phase2Passes && hasDescKeyword) {
        const jobContent = job.content.toLowerCase();
        const matchedDescKw = descKeywordTokens.find((kw) =>
          jobContent.includes(kw),
        );
        if (matchedDescKw) {
          phase2Passes = true;
          phase2Reason = `Description keyword match: "${matchedDescKw}" found in job content`;
        }
      }

      if (!phase2Passes) {
        const descInfo = hasDescKeyword
          ? config.descriptionKeyword
          : '(none)';
        rejected.push({
          id: job.id,
          title: job.title,
          url: job.absolute_url,
          rejectedAtStage: 2,
          reason: `Rejected by Phase 2 filter: "${job.title}" in "${job.department.name}" does not match (role keyword AND department) and no description keyword match in [${descInfo}]`,
        });
        continue;
      }
    }

    // Build match reason
    let matchReason: string;
    if (locationMatched) {
      matchReason = locationMatched.length > 0
        ? `Location match: "${job.location.name}" includes "${locationMatched}"`
        : '';
    } else {
      matchReason = 'Location filter not configured (any location accepted)';
    }

    if (phase2Reason) {
      matchReason += (matchReason ? '; ' : '') + phase2Reason;
    } else if (!phase2Configured) {
      matchReason += '; No Phase 2 filters configured';
    }

    // Job passed both phases
    passed.push(toFilteredJob(job, matchReason));
  }

  if (passed.length === 0) {
    throw new ConfigMismatchError(
      'Zero jobs survived Stage 2 (metadata filter). Check your filter config (location, departments, keyword, descriptionKeyword).',
    );
  }

  return { passed, rejected };
}
