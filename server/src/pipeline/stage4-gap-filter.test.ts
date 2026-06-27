/**
 * Stage 4 — Gap Filter tests
 *
 * @jest-environment node
 */

import {
  matchSkill,
  computeGapRatio,
  filterByGap,
} from './stage4-gap-filter';
import type { ExtractedJob, StageResult, GatedJob } from '../types';
import type { SkillsProfile } from '../config/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal ExtractedJob with sensible defaults.
 */
function createExtractedJob(
  overrides: Partial<ExtractedJob> = {},
): ExtractedJob {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? 'Software Engineer',
    content: overrides.content ?? '<p>Some description</p>',
    location: overrides.location ?? 'San Francisco, CA',
    department: overrides.department ?? 'Engineering',
    url: overrides.url ?? 'https://boards.greenhouse.io/figma/jobs/1',
    requirements: overrides.requirements ?? {
      must_haves: [],
      nice_to_haves: [],
    },
  };
}

/**
 * Default skills profile matching the adam.json fixture shape.
 */
const defaultProfile: SkillsProfile = {
  skills: [
    { name: 'TypeScript', strength: 'must_have' },
    { name: 'React', strength: 'must_have' },
    { name: 'Node.js', strength: 'must_have' },
    { name: 'PostgreSQL', strength: 'nice_to_have' },
    { name: 'Docker', strength: 'nice_to_have' },
    { name: 'Figma', strength: 'preferred' },
  ],
  gapThreshold: 0.5,
};

// ---------------------------------------------------------------------------
// matchSkill
// ---------------------------------------------------------------------------

describe('matchSkill', () => {
  test('exact name match', () => {
    expect(matchSkill('TypeScript', { name: 'TypeScript' })).toBe(true);
  });

  test('alias match', () => {
    expect(
      matchSkill('TS', { name: 'TypeScript', aliases: ['TS', 'Typescript'] }),
    ).toBe(true);
  });

  test('partial substring match', () => {
    expect(matchSkill('Script', { name: 'TypeScript' })).toBe(true);
  });

  test('case-insensitive name', () => {
    expect(matchSkill('typescript', { name: 'TypeScript' })).toBe(true);
    expect(matchSkill('TYPESCRIPT', { name: 'TypeScript' })).toBe(true);
  });

  test('case-insensitive alias', () => {
    expect(
      matchSkill('ts', { name: 'TypeScript', aliases: ['TS', 'Typescript'] }),
    ).toBe(true);
  });

  test('low-strength counts as match', () => {
    expect(
      matchSkill('Figma', { name: 'Figma', strength: 'preferred' }),
    ).toBe(true);
  });

  test('no match returns false', () => {
    expect(matchSkill('Python', { name: 'TypeScript' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeGapRatio
// ---------------------------------------------------------------------------

describe('computeGapRatio', () => {
  const skills = defaultProfile.skills;

  test('all matched', () => {
    const mustHaves = ['TypeScript', 'React', 'Node.js'];
    expect(computeGapRatio(mustHaves, skills)).toBe(0);
  });

  test('half matched', () => {
    const mustHaves = ['TypeScript', 'Python', 'Node.js', 'Go'];
    // TypeScript and Node.js match (2), Python and Go do not (2)
    // ratio = 2/4 = 0.5
    expect(computeGapRatio(mustHaves, skills)).toBe(0.5);
  });

  test('none matched', () => {
    const mustHaves = ['Python', 'Go', 'Rust'];
    expect(computeGapRatio(mustHaves, skills)).toBe(1);
  });

  test('empty must-haves returns ratio 0', () => {
    expect(computeGapRatio([], skills)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// filterByGap
// ---------------------------------------------------------------------------

describe('filterByGap', () => {
  test('below threshold passes', () => {
    // All must-haves match → gapRatio = 0 < 0.5 → pass
    const job = createExtractedJob({
      id: 1,
      requirements: {
        must_haves: ['TypeScript', 'React'],
        nice_to_haves: ['Docker'],
      },
    });

    const result: StageResult<GatedJob> = filterByGap([job], defaultProfile);

    expect(result.passed).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.passed[0].id).toBe(1);
    expect(result.passed[0].gapRatio).toBe(0);
    expect(result.passed[0].matchedSkills).toEqual(['TypeScript', 'React']);
    expect(result.passed[0].unmatchedSkills).toEqual([]);
  });

  test('at threshold rejected', () => {
    // 1 out of 2 must-haves match → gapRatio = 0.5 === gapThreshold → reject
    const job = createExtractedJob({
      id: 2,
      requirements: {
        must_haves: ['TypeScript', 'Python'],
        nice_to_haves: [],
      },
    });

    const result: StageResult<GatedJob> = filterByGap([job], defaultProfile);

    expect(result.passed).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(2);
    expect(result.rejected[0].rejectedAtStage).toBe(4);
  });

  test('above threshold rejected', () => {
    // 0 out of 2 must-haves match → gapRatio = 1 > 0.5 → reject
    const job = createExtractedJob({
      id: 3,
      requirements: {
        must_haves: ['Python', 'Go'],
        nice_to_haves: [],
      },
    });

    const result: StageResult<GatedJob> = filterByGap([job], defaultProfile);

    expect(result.passed).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(3);
    expect(result.rejected[0].rejectedAtStage).toBe(4);
  });

  test('rejection reason names unmatched skills', () => {
    const job = createExtractedJob({
      id: 4,
      title: 'Backend Engineer',
      requirements: {
        must_haves: ['TypeScript', 'Python', 'Go', 'Kubernetes'],
        nice_to_haves: [],
      },
    });

    const result: StageResult<GatedJob> = filterByGap([job], defaultProfile);

    expect(result.passed).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Python');
    expect(result.rejected[0].reason).toContain('Go');
    expect(result.rejected[0].reason).toContain('Kubernetes');
    // TypeScript matched, so it should NOT be in the reason
    expect(result.rejected[0].reason).not.toContain('TypeScript');
  });

  test('GatedJob contains correct matched/unmatched arrays', () => {
    const job = createExtractedJob({
      id: 5,
      requirements: {
        must_haves: ['React', 'Python', 'Node.js', 'Go'],
        nice_to_haves: [],
      },
    });

    const result: StageResult<GatedJob> = filterByGap([job], defaultProfile);

    // gapRatio = 2/4 = 0.5 === gapThreshold (0.5) → rejected
    expect(result.passed).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(5);
    // The rejected job's reason should contain the unmatched skills
    expect(result.rejected[0].reason).toContain('Python');
    expect(result.rejected[0].reason).toContain('Go');
  });
});
