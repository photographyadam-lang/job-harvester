/**
 * Stage 2 — Metadata Filter tests
 *
 * @jest-environment node
 */

import { filterJobs, ConfigMismatchError } from './stage2-filter';
import type { RawJob, FilterConfig, FilteredJob, StageResult } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal RawJob with sensible defaults.
 */
function createRawJob(
  overrides: Partial<{
    id: number;
    title: string;
    content: string;
    locationName: string;
    departmentName: string;
    absoluteUrl: string;
  }> = {},
): RawJob {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? 'Software Engineer',
    content: overrides.content ?? '<p>Some description</p>',
    location: { name: overrides.locationName ?? 'San Francisco, CA' },
    department: { name: overrides.departmentName ?? 'Engineering' },
    absolute_url: overrides.absoluteUrl ?? 'https://boards.greenhouse.io/figma/jobs/1',
  };
}

/**
 * Default filter config that should retain most test jobs.
 */
const _defaultConfig: FilterConfig = {
  location: 'San Francisco',
  departments: ['Engineering'],
  keyword: 'Software',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('filterJobs', () => {
  // -----------------------------------------------------------------------
  // Location filter
  // -----------------------------------------------------------------------

  test('location retained', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, locationName: 'San Francisco, CA' }),
      createRawJob({ id: 2, locationName: 'Remote (US)' }),
    ];

    const config: FilterConfig = { location: 'Remote', departments: ['Engineering'], keyword: 'Software' };
    const result: StageResult<FilteredJob> = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(1);
    expect(result.rejected[0].rejectedAtStage).toBe(2);
    expect(result.rejected[0].reason).toMatch(/location/i);
    expect(result.rejected[0].reason).toContain('San Francisco');
  });

  test('location excluded', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, locationName: 'New York, NY' }),
      createRawJob({ id: 2, locationName: 'San Francisco, CA' }),
    ];

    const config: FilterConfig = { location: 'San Francisco', departments: ['Engineering'], keyword: 'Engineer' };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(1);
    expect(result.rejected[0].reason).toMatch(/location/i);
  });

  // -----------------------------------------------------------------------
  // Department filter
  // -----------------------------------------------------------------------

  test('department retained', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, departmentName: 'Engineering' }),
      createRawJob({ id: 2, departmentName: 'Marketing' }),
    ];

    const config: FilterConfig = { location: '', departments: ['Engineering'], keyword: '' };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(2);
    expect(result.rejected[0].reason).toMatch(/department/i);
    expect(result.rejected[0].reason).toContain('Marketing');
  });

  test('department excluded', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, departmentName: 'Engineering' }),
      createRawJob({ id: 2, departmentName: 'Sales' }),
    ];

    const config: FilterConfig = { location: '', departments: ['Engineering'], keyword: '' };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(2);
    expect(result.rejected[0].reason).toMatch(/department/i);
  });

  // -----------------------------------------------------------------------
  // Keyword filter (single keyword)
  // -----------------------------------------------------------------------

  test('keyword retained (single)', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, title: 'Software Engineer' }),
      createRawJob({ id: 2, title: 'Product Manager' }),
    ];

    const config: FilterConfig = { location: '', departments: [], keyword: 'Engineer' };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(2);
    expect(result.rejected[0].reason).toMatch(/keyword/i);
    expect(result.rejected[0].reason).toContain('Product Manager');
  });

  test('keyword excluded (single)', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, title: 'Software Engineer' }),
      createRawJob({ id: 2, title: 'Accountant' }),
    ];

    const config: FilterConfig = { location: '', departments: [], keyword: 'Engineer' };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(2);
    expect(result.rejected[0].reason).toMatch(/keyword/i);
  });

  // -----------------------------------------------------------------------
  // Keyword filter (comma-separated, OR logic)
  // -----------------------------------------------------------------------

  test('keyword retained (comma-separated, OR logic)', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, title: 'Technical Program Manager' }),
      createRawJob({ id: 2, title: 'Privacy Engineer' }),
      createRawJob({ id: 3, title: 'Project Coordinator' }),
      createRawJob({ id: 4, title: 'Software Engineer' }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: [],
      keyword: 'Project, Program, Privacy, Management',
    };

    const result = filterJobs(jobs, config);

    // Job 1 matches "Program" and "Management", Job 2 matches "Privacy",
    // Job 3 matches "Project". Job 4 matches none.
    expect(result.passed).toHaveLength(3);
    expect(result.passed.map((j) => j.id).sort()).toEqual([1, 2, 3]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(4);
    expect(result.rejected[0].reason).toMatch(/keyword/i);
  });

  test('keyword excluded (comma-separated, none match)', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, title: 'Software Engineer' }),
      createRawJob({ id: 2, title: 'Data Scientist' }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: [],
      keyword: 'Project, Program, Privacy, Management',
    };

    // None of these titles contain any of the keywords
    expect(() => filterJobs(jobs, config)).toThrow(ConfigMismatchError);
  });

  test('keyword trims whitespace around comma-separated terms', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, title: 'Technical Program Manager' }),
    ];

    // Leading/trailing spaces around commas should be trimmed
    const config: FilterConfig = {
      location: '',
      departments: [],
      keyword: ' Project ,  Program , Privacy , Management ',
    };

    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Case-insensitivity
  // -----------------------------------------------------------------------

  test('case-insensitive location', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, locationName: 'remote (US)' }),
      createRawJob({ id: 2, locationName: 'New York, NY' }),
    ];

    const config: FilterConfig = { location: 'Remote', departments: [], keyword: '' };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
  });

  test('case-insensitive department', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, departmentName: 'engineering' }),
      createRawJob({ id: 2, departmentName: 'Marketing' }),
    ];

    const config: FilterConfig = { location: '', departments: ['Engineering'], keyword: '' };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
  });

  test('case-insensitive keyword', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, title: 'software engineer' }),
      createRawJob({ id: 2, title: 'Product Manager' }),
    ];

    const config: FilterConfig = { location: '', departments: [], keyword: 'Software' };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Zero survivors
  // -----------------------------------------------------------------------

  test('zero-survivors throws ConfigMismatchError', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, locationName: 'New York, NY', departmentName: 'Marketing', title: 'Accountant' }),
    ];

    const config: FilterConfig = { location: 'Remote', departments: ['Engineering'], keyword: 'Engineer' };

    expect(() => filterJobs(jobs, config)).toThrow(ConfigMismatchError);
  });

  // -----------------------------------------------------------------------
  // rejectedAtStage
  // -----------------------------------------------------------------------

  test('all rejected jobs have rejectedAtStage: 2', () => {
    // One job passes all filters; the rest fail at different filter levels.
    const jobs: RawJob[] = [
      createRawJob({ id: 1, locationName: 'San Francisco, CA', departmentName: 'Engineering', title: 'Software Engineer' }),
      createRawJob({ id: 2, locationName: 'Austin, TX', departmentName: 'Engineering', title: 'Software Engineer' }),
      createRawJob({ id: 3, locationName: 'San Francisco, CA', departmentName: 'Marketing', title: 'Software Engineer' }),
      createRawJob({ id: 4, locationName: 'San Francisco, CA', departmentName: 'Engineering', title: 'Accountant' }),
    ];

    const config: FilterConfig = { location: 'San Francisco', departments: ['Engineering'], keyword: 'Engineer' };
    const result = filterJobs(jobs, config);

    // Job 1 passes all three; Job 2 fails location; Job 3 passes location fails department; Job 4 passes location & department fails keyword
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected.every((r: { rejectedAtStage: number }) => r.rejectedAtStage === 2)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // First failing filter is reported
  // -----------------------------------------------------------------------

  test('first failing filter is the one reported', () => {
    // Three jobs each fail at a different filter, ensuring the first failing
    // filter is the one reported (not a later one).
    const jobs: RawJob[] = [
      // Fails location filter (first) — should report location
      createRawJob({
        id: 1,
        locationName: 'New York, NY',
        departmentName: 'Marketing',
        title: 'Accountant',
      }),
      // Passes location, fails department — should report department
      createRawJob({
        id: 2,
        locationName: 'San Francisco, CA',
        departmentName: 'Marketing',
        title: 'Accountant',
      }),
      // One job passes all three so ConfigMismatchError is not thrown
      createRawJob({
        id: 3,
        locationName: 'San Francisco, CA',
        departmentName: 'Engineering',
        title: 'Software Engineer',
      }),
    ];

    const config: FilterConfig = { location: 'San Francisco', departments: ['Engineering'], keyword: 'Engineer' };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(3);
    expect(result.rejected).toHaveLength(2);

    // Job 1 fails location first
    expect(result.rejected[0].id).toBe(1);
    expect(result.rejected[0].reason).toMatch(/location/i);
    expect(result.rejected[0].reason).toContain('New York');

    // Job 2 passes location but fails department
    expect(result.rejected[1].id).toBe(2);
    expect(result.rejected[1].reason).toMatch(/department/i);
    expect(result.rejected[1].reason).toContain('Marketing');
  });
});
