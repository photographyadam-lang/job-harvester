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
  descriptionKeyword: '',
};

// =========================================================================
// Phase 1 — Location filter (all tests unchanged from original)
// =========================================================================

describe('filterJobs', () => {
  // -----------------------------------------------------------------------
  // Location filter
  // -----------------------------------------------------------------------

  test('location retained', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, locationName: 'San Francisco, CA' }),
      createRawJob({ id: 2, locationName: 'Remote (US)' }),
    ];

    const config: FilterConfig = {
      location: 'Remote',
      departments: ['Engineering'],
      keyword: 'Software',
      descriptionKeyword: '',
    };
    const result: StageResult<FilteredJob> = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(2);
    expect(result.passed[0].matchReason).toMatch(/Location match/);
    expect(result.passed[0].matchReason).toContain('remote');
    expect(result.passed[0].matchReason).toMatch(/Role\+Dept match/);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(1);
    expect(result.rejected[0].rejectedAtStage).toBe(2);
    expect(result.rejected[0].reason).toMatch(/location/i);
    expect(result.rejected[0].reason).toContain('San Francisco, CA');
    expect(result.rejected[0].reason).toContain('[Remote]');
  });

  test('location excluded', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, locationName: 'New York, NY' }),
      createRawJob({ id: 2, locationName: 'San Francisco, CA' }),
    ];

    const config: FilterConfig = {
      location: 'San Francisco',
      departments: ['Engineering'],
      keyword: 'Engineer',
      descriptionKeyword: '',
    };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(1);
    expect(result.rejected[0].reason).toMatch(/location/i);
    expect(result.rejected[0].reason).toContain('[San Francisco]');
  });

  // -----------------------------------------------------------------------
  // Case-insensitivity (location)
  // -----------------------------------------------------------------------

  test('case-insensitive location', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, locationName: 'remote (US)' }),
      createRawJob({ id: 2, locationName: 'New York, NY' }),
    ];

    const config: FilterConfig = {
      location: 'Remote',
      departments: [],
      keyword: '',
      descriptionKeyword: '',
    };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Location filter (comma-separated, OR logic)
  // -----------------------------------------------------------------------

  test('location retained (comma-separated, OR logic)', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, locationName: 'Remote - Virginia' }),
      createRawJob({ id: 2, locationName: 'San Francisco, CA' }),
      createRawJob({ id: 3, locationName: 'New York, NY' }),
      createRawJob({ id: 4, locationName: 'London, UK' }),
    ];

    const config: FilterConfig = {
      location: 'Remote, San Francisco',
      departments: [],
      keyword: '',
      descriptionKeyword: '',
    };

    const result = filterJobs(jobs, config);

    // Jobs 1 & 2 match "Remote" and "San Francisco" respectively via substring.
    // Jobs 3 & 4 match neither.
    expect(result.passed).toHaveLength(2);
    expect(result.passed.map((j) => j.id).sort()).toEqual([1, 2]);
    expect(result.passed[0].matchReason).toMatch(/Location match/);
    expect(result.passed[0].matchReason).toMatch(/No Phase 2 filters configured/);
    expect(result.passed[1].matchReason).toMatch(/Location match/);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.map((j) => j.id).sort()).toEqual([3, 4]);
    expect(result.rejected.every((r) => r.reason.includes('location'))).toBe(true);
  });

  test('location trims whitespace around comma-separated terms', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, locationName: 'Remote - US' }),
    ];

    const config: FilterConfig = {
      location: ' Remote ,  San Francisco ',
      departments: [],
      keyword: '',
      descriptionKeyword: '',
    };

    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Pipe-delimited location strings
  // -----------------------------------------------------------------------

  test('pipe-delimited location matches any segment', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        locationName: 'San Francisco, CA | New York City, NY | Seattle, WA',
        title: 'Software Engineer',
      }),
      createRawJob({
        id: 2,
        locationName: 'London, UK | Paris, France',
        title: 'Data Scientist',
      }),
    ];

    const config: FilterConfig = {
      location: 'San Francisco',
      departments: [],
      keyword: '',
      descriptionKeyword: '',
    };

    const result = filterJobs(jobs, config);

    // Only job 1 should pass — its location contains "San Francisco, CA" segment
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(2);
  });

  test('pipe-delimited location matches any of multiple target locations', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        locationName: 'San Francisco, CA | New York City, NY | Seattle, WA',
        title: 'Engineer',
      }),
      createRawJob({
        id: 2,
        locationName: 'London, UK | Paris, France',
        title: 'Engineer',
      }),
      createRawJob({
        id: 3,
        locationName: 'Remote - US',
        title: 'Engineer',
      }),
    ];

    const config: FilterConfig = {
      location: 'Seattle, Remote',
      departments: [],
      keyword: '',
      descriptionKeyword: '',
    };

    const result = filterJobs(jobs, config);

    // Job 1 matches "Seattle" in its third segment
    // Job 3 matches "Remote" directly
    // Job 2 matches neither
    expect(result.passed).toHaveLength(2);
    expect(result.passed.map((j) => j.id).sort()).toEqual([1, 3]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(2);
  });

  test('pipe-delimited location rejected when no segment matches', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        locationName: 'San Francisco, CA | New York City, NY',
        title: 'Engineer',
      }),
    ];

    const config: FilterConfig = {
      location: 'London',
      departments: [],
      keyword: '',
      descriptionKeyword: '',
    };

    expect(() => filterJobs(jobs, config)).toThrow(ConfigMismatchError);
  });

  test('pipe-delimited location with empty config location passes all', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        locationName: 'San Francisco, CA | New York City, NY | Remote',
        title: 'Engineer',
      }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: [],
      keyword: '',
      descriptionKeyword: '',
    };

    const result = filterJobs(jobs, config);
    expect(result.passed).toHaveLength(1);
  });

  test('pipe-delimited location trims whitespace around segments', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        locationName: '  San Francisco, CA  |  New York City, NY  |  Seattle, WA  ',
        title: 'Engineer',
      }),
    ];

    const config: FilterConfig = {
      location: 'Seattle',
      departments: [],
      keyword: '',
      descriptionKeyword: '',
    };

    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
  });

  // =========================================================================
  // Phase 2 — (Role Keyword AND Departments) OR (Description Keyword)
  // =========================================================================

  // -----------------------------------------------------------------------
  // Branch A: (Role Keyword AND Departments) — both match
  // -----------------------------------------------------------------------

  test('Branch A: keyword AND department both match → passes', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, title: 'Software Engineer', departmentName: 'Engineering' }),
      createRawJob({ id: 2, title: 'Data Scientist', departmentName: 'Engineering' }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: ['Engineering'],
      keyword: 'Engineer',
      descriptionKeyword: '',
    };

    const result = filterJobs(jobs, config);

    // Job 1: keyword match + dept match → passes
    // Job 2: keyword no match → Branch A fails, no Branch B → rejected
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
    expect(result.passed[0].matchReason).toMatch(/Role\+Dept match/);
    expect(result.passed[0].matchReason).toContain('engineer');
    expect(result.passed[0].matchReason).toContain('Engineering');
    expect(result.passed[0].matchReason).toMatch(/Location filter not configured/);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(2);
    expect(result.rejected[0].reason).toMatch(/Phase 2/i);
  });

  test('Branch A: keyword fails, department passes → rejected', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, title: 'Accountant', departmentName: 'Engineering' }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: ['Engineering'],
      keyword: 'Engineer',
      descriptionKeyword: '',
    };

    // Keyword doesn't match title → Branch A fails, no Branch B → rejected
    expect(() => filterJobs(jobs, config)).toThrow(ConfigMismatchError);
  });

  test('Branch A: department fails, keyword passes → rejected', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, title: 'Software Engineer', departmentName: 'Marketing' }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: ['Engineering'],
      keyword: 'Engineer',
      descriptionKeyword: '',
    };

    // Department not in list → Branch A fails, no Branch B → rejected
    expect(() => filterJobs(jobs, config)).toThrow(ConfigMismatchError);
  });

  // -----------------------------------------------------------------------
  // Branch A: keyword (comma-separated, OR logic)
  // -----------------------------------------------------------------------

  test('Branch A: keyword comma-separated OR logic on title', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, title: 'Technical Program Manager', departmentName: 'Engineering' }),
      createRawJob({ id: 2, title: 'Privacy Engineer', departmentName: 'Engineering' }),
      createRawJob({ id: 3, title: 'Project Coordinator', departmentName: 'Engineering' }),
      createRawJob({ id: 4, title: 'Software Engineer', departmentName: 'Engineering' }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: ['Engineering'],
      keyword: 'Project, Program, Privacy, Management',
      descriptionKeyword: '',
    };

    const result = filterJobs(jobs, config);

    // Job 1 matches "Program" and "Management", Job 2 matches "Privacy",
    // Job 3 matches "Project". Job 4 matches none → rejected.
    expect(result.passed).toHaveLength(3);
    expect(result.passed.map((j) => j.id).sort()).toEqual([1, 2, 3]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(4);
    expect(result.rejected[0].reason).toMatch(/Phase 2/i);
  });

  // -----------------------------------------------------------------------
  // Branch A: keyword empty or departments empty → Branch A disabled
  // -----------------------------------------------------------------------

  test('keyword empty → Branch A disabled, only Branch B can pass', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        title: 'Software Engineer',
        departmentName: 'Engineering',
        content: '<p>We need a privacy expert</p>',
      }),
      createRawJob({
        id: 2,
        title: 'Product Manager',
        departmentName: 'Marketing',
        content: '<p>General role</p>',
      }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: ['Engineering'],
      keyword: '',
      descriptionKeyword: 'privacy',
    };

    const result = filterJobs(jobs, config);

    // Job 1: keyword empty, dept set → Branch A disabled, Branch B matches "privacy" → passes
    // Job 2: keyword empty, dept set → Branch A disabled, Branch B no match → rejected
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(2);
    expect(result.rejected[0].reason).toMatch(/Phase 2/i);
  });

  test('departments empty → Branch A disabled, only Branch B can pass', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        title: 'Software Engineer',
        departmentName: 'Engineering',
        content: '<p>We need a privacy expert</p>',
      }),
      createRawJob({
        id: 2,
        title: 'Product Manager',
        departmentName: 'Marketing',
        content: '<p>General role</p>',
      }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: [],
      keyword: 'Engineer',
      descriptionKeyword: 'privacy',
    };

    const result = filterJobs(jobs, config);

    // Job 1: dept empty, keyword set → Branch A disabled, Branch B matches "privacy" → passes
    // Job 2: dept empty, keyword set → Branch A disabled, Branch B no match → rejected
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Branch B: Description Keyword
  // -----------------------------------------------------------------------

  test('Branch B: descriptionKeyword match in content → passes regardless of keyword/dept', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        title: 'Accountant',
        departmentName: 'Finance',
        content: '<p>This role involves privacy compliance and GDPR regulations</p>',
      }),
      createRawJob({
        id: 2,
        title: 'Software Engineer',
        departmentName: 'Engineering',
        content: '<p>Build APIs</p>',
      }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: ['Engineering'],
      keyword: 'Engineer',
      descriptionKeyword: 'privacy, GDPR',
    };

    const result = filterJobs(jobs, config);

    // Job 1: fails Branch A (keyword+dept) but Branch B matches "privacy" → passes
    // Job 2: passes Branch A (keyword+dept) → passes
    expect(result.passed).toHaveLength(2);
    expect(result.passed.map((j) => j.id).sort()).toEqual([1, 2]);

    // Job 1 should have description keyword match reason
    const job1 = result.passed.find((j) => j.id === 1)!;
    expect(job1.matchReason).toMatch(/Description keyword match/);
    expect(job1.matchReason).toContain('privacy');

    // Job 2 should have Role+Dept match reason
    const job2 = result.passed.find((j) => j.id === 2)!;
    expect(job2.matchReason).toMatch(/Role\+Dept match/);
    expect(result.rejected).toHaveLength(0);
  });

  test('Branch B: descriptionKeyword saves job that fails Branch A', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        title: 'Privacy Engineer',
        departmentName: 'Legal',          // not in departments
        content: '<p>GDPR compliance and data protection</p>',
      }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: ['Engineering'],        // Legal is not here
      keyword: 'Engineer',                 // title matches
      descriptionKeyword: 'GDPR',          // content matches
    };

    const result = filterJobs(jobs, config);

    // Branch A: keyword matches but dept fails → no
    // Branch B: "GDPR" found in content → passes
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
    expect(result.rejected).toHaveLength(0);
  });

  test('Branch B: descriptionKeyword fails, Branch A also fails → rejected', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        title: 'Accountant',
        departmentName: 'Finance',
        content: '<p>Standard accounting duties</p>',
      }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: ['Engineering'],
      keyword: 'Engineer',
      descriptionKeyword: 'privacy',
    };

    // Both branches fail → zero survivors
    expect(() => filterJobs(jobs, config)).toThrow(ConfigMismatchError);
  });

  test('Branch B: descriptionKeyword comma-separated OR logic', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        title: 'Analyst',
        departmentName: 'Finance',
        content: '<p>Focus on risk management frameworks</p>',
      }),
      createRawJob({
        id: 2,
        title: 'Coordinator',
        departmentName: 'Operations',
        content: '<p>General operations</p>',
      }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: [],
      keyword: '',
      descriptionKeyword: 'privacy, risk, compliance, GDPR',
    };

    const result = filterJobs(jobs, config);

    // Job 1: "risk" found → passes
    // Job 2: none found → rejected
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(2);
  });

  test('Branch B: descriptionKeyword trims whitespace around commas', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        title: 'Analyst',
        departmentName: 'Finance',
        content: '<p>GDPR compliance role</p>',
      }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: [],
      keyword: '',
      descriptionKeyword: ' privacy ,  GDPR ,  risk ',
    };

    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Case-insensitivity (Phase 2)
  // -----------------------------------------------------------------------

  test('case-insensitive keyword in Branch A', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, title: 'software engineer', departmentName: 'Engineering' }),
      createRawJob({ id: 2, title: 'Product Manager', departmentName: 'Engineering' }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: ['Engineering'],
      keyword: 'Software',
      descriptionKeyword: '',
    };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
  });

  test('case-insensitive department in Branch A', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, departmentName: 'engineering', title: 'Software Engineer' }),
      createRawJob({ id: 2, departmentName: 'Marketing', title: 'Software Engineer' }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: ['Engineering'],
      keyword: 'Software',
      descriptionKeyword: '',
    };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
  });

  test('department with trailing whitespace matches trimmed config value', () => {
    // Greenhouse API sometimes returns department names with trailing spaces,
    // e.g. "Technical Program Management " vs config "Technical Program Management".
    const jobs: RawJob[] = [
      createRawJob({ id: 1, departmentName: 'Technical Program Management ', title: 'TPM' }),
      createRawJob({ id: 2, departmentName: 'Engineering ', title: 'Engineer' }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: ['Technical Program Management', 'Engineering'],
      keyword: 'TPM, Engineer',
      descriptionKeyword: '',
    };
    const result = filterJobs(jobs, config);

    // Both should match because the department value is trimmed before comparison
    expect(result.passed).toHaveLength(2);
    expect(result.passed.map((j) => j.id).sort()).toEqual([1, 2]);
    expect(result.rejected).toHaveLength(0);
  });

  test('case-insensitive descriptionKeyword', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        title: 'Analyst',
        departmentName: 'Finance',
        content: '<p>GDPR COMPLIANCE role</p>',
      }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: [],
      keyword: '',
      descriptionKeyword: 'gdpr',
    };

    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
  });

  // -----------------------------------------------------------------------
  // All Phase 2 fields empty
  // -----------------------------------------------------------------------

  test('all Phase 2 fields empty → passes all jobs through', () => {
    const jobs: RawJob[] = [
      createRawJob({ id: 1, title: 'Software Engineer', departmentName: 'Engineering' }),
      createRawJob({ id: 2, title: 'Accountant', departmentName: 'Finance' }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: [],
      keyword: '',
      descriptionKeyword: '',
    };

    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(2);
    expect(result.passed[0].matchReason).toMatch(/Location filter not configured/);
    expect(result.passed[0].matchReason).toMatch(/No Phase 2 filters configured/);
    expect(result.passed[1].matchReason).toMatch(/No Phase 2 filters configured/);
    expect(result.rejected).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Zero survivors
  // -----------------------------------------------------------------------

  test('zero-survivors throws ConfigMismatchError', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        locationName: 'New York, NY',
        departmentName: 'Marketing',
        title: 'Accountant',
        content: '<p>General</p>',
      }),
    ];

    const config: FilterConfig = {
      location: 'Remote',
      departments: ['Engineering'],
      keyword: 'Engineer',
      descriptionKeyword: 'privacy',
    };

    expect(() => filterJobs(jobs, config)).toThrow(ConfigMismatchError);
  });

  // -----------------------------------------------------------------------
  // rejectedAtStage
  // -----------------------------------------------------------------------

  test('all rejected jobs have rejectedAtStage: 2', () => {
    const jobs: RawJob[] = [
      // Passes all
      createRawJob({
        id: 1,
        locationName: 'San Francisco, CA',
        departmentName: 'Engineering',
        title: 'Software Engineer',
        content: '<p>API development</p>',
      }),
      // Fails location
      createRawJob({
        id: 2,
        locationName: 'Austin, TX',
        departmentName: 'Engineering',
        title: 'Software Engineer',
        content: '<p>API development</p>',
      }),
      // Passes location, fails Phase 2 (wrong dept, no desc keyword)
      createRawJob({
        id: 3,
        locationName: 'San Francisco, CA',
        departmentName: 'Marketing',
        title: 'Software Engineer',
        content: '<p>General</p>',
      }),
      // Passes location, fails Phase 2 (keyword mismatch, no desc keyword)
      createRawJob({
        id: 4,
        locationName: 'San Francisco, CA',
        departmentName: 'Engineering',
        title: 'Accountant',
        content: '<p>General</p>',
      }),
    ];

    const config: FilterConfig = {
      location: 'San Francisco',
      departments: ['Engineering'],
      keyword: 'Engineer',
      descriptionKeyword: '',
    };
    const result = filterJobs(jobs, config);

    // Job 1 passes all
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected.every((r: { rejectedAtStage: number }) => r.rejectedAtStage === 2)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // First failing filter is reported (location before Phase 2)
  // -----------------------------------------------------------------------

  test('first failing filter is the one reported', () => {
    const jobs: RawJob[] = [
      // Fails location filter (first) — should report location
      createRawJob({
        id: 1,
        locationName: 'New York, NY',
        departmentName: 'Marketing',
        title: 'Accountant',
        content: '<p>General</p>',
      }),
      // Passes location, fails Phase 2 — should report Phase 2
      createRawJob({
        id: 2,
        locationName: 'San Francisco, CA',
        departmentName: 'Marketing',
        title: 'Accountant',
        content: '<p>General</p>',
      }),
      // One job passes everything so ConfigMismatchError is not thrown
      createRawJob({
        id: 3,
        locationName: 'San Francisco, CA',
        departmentName: 'Engineering',
        title: 'Software Engineer',
        content: '<p>General</p>',
      }),
    ];

    const config: FilterConfig = {
      location: 'San Francisco',
      departments: ['Engineering'],
      keyword: 'Engineer',
      descriptionKeyword: '',
    };
    const result = filterJobs(jobs, config);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(3);
    expect(result.rejected).toHaveLength(2);

    // Job 1 fails location first
    expect(result.rejected[0].id).toBe(1);
    expect(result.rejected[0].reason).toMatch(/location/i);
    expect(result.rejected[0].reason).toContain('New York, NY');
    expect(result.rejected[0].reason).toContain('[San Francisco]');

    // Job 2 passes location but fails Phase 2
    expect(result.rejected[1].id).toBe(2);
    expect(result.rejected[1].reason).toMatch(/Phase 2/i);
    expect(result.rejected[1].reason).toContain('Marketing');
  });

  // -----------------------------------------------------------------------
  // Short-circuit: Branch A passes → Branch B not evaluated
  // -----------------------------------------------------------------------

  test('Branch A passes → Branch B not evaluated (short-circuit)', () => {
    const jobs: RawJob[] = [
      createRawJob({
        id: 1,
        title: 'Software Engineer',
        departmentName: 'Engineering',
        content: '<p>irrelevant</p>',
      }),
    ];

    const config: FilterConfig = {
      location: '',
      departments: ['Engineering'],
      keyword: 'Engineer',
      descriptionKeyword: 'privacy',
    };

    const result = filterJobs(jobs, config);

    // Branch A passes (keyword+dept) — content doesn't matter
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].id).toBe(1);
  });
});
