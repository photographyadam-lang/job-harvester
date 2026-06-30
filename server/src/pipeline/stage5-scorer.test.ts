/**
 * Stage 5 — Scorer tests
 *
 * @jest-environment node
 */

import { scoreJobs } from './stage5-scorer';
import * as deepseekClient from '../llm/deepseekClient';
import type { GatedJob, Stage5Result } from '../types';
import type { SkillsProfile } from '../config/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockedCallDeepSeek = jest
  .spyOn(deepseekClient, 'callDeepSeek')
  .mockRejectedValue(new Error('unexpected call'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal GatedJob with sensible defaults.
 */
function createGatedJob(overrides: Partial<GatedJob> = {}): GatedJob {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? 'Software Engineer',
    content: overrides.content ?? '<p>Job description</p>',
    location: overrides.location ?? 'San Francisco, CA',
    department: overrides.department ?? 'Engineering',
    url: overrides.url ?? 'https://boards.greenhouse.io/figma/jobs/1',
    matchReason: overrides.matchReason ?? 'test match reason',
    requirements: overrides.requirements ?? {
      must_haves: ['TypeScript', 'React'],
      nice_to_haves: ['Docker'],
    },
    gapRatio: overrides.gapRatio ?? 0,
    matchedSkills: overrides.matchedSkills ?? ['TypeScript', 'React'],
    unmatchedSkills: overrides.unmatchedSkills ?? [],
  };
}

/**
 * Default skills profile.
 */
const defaultProfile: SkillsProfile = {
  skills: [
    { name: 'TypeScript', strength: 'must_have' },
    { name: 'React', strength: 'must_have' },
    { name: 'Node.js', strength: 'must_have' },
    { name: 'PostgreSQL', strength: 'nice_to_have' },
    { name: 'Docker', strength: 'nice_to_have' },
  ],
  gapThreshold: 0.5,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

describe('scoreJobs', () => {
  // -------------------------------------------------------------------------
  // 1. Valid score produces ScoredJob
  // -------------------------------------------------------------------------

  test('valid score produces ScoredJob', async () => {
    const job = createGatedJob({ id: 10 });
    mockedCallDeepSeek.mockResolvedValue({
      content: JSON.stringify({
        score: 8,
        scoreReasoning: 'Strong match across must-have skills',
      }),
      model: 'deepseek-chat',
      usage: { promptTokens: 150, completionTokens: 30 },
    });

    const result: Stage5Result = await scoreJobs([job], defaultProfile);

    expect(result.scoredJobs).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);

    const scored = result.scoredJobs[0];
    expect(scored.id).toBe(10);
    expect(scored.score).toBe(8);
    expect(scored.scoreReasoning).toBe('Strong match across must-have skills');
    // Should still be a GatedJob (extends it)
    expect(scored.gapRatio).toBe(0);
    expect(scored.matchedSkills).toEqual(['TypeScript', 'React']);
  });

  // -------------------------------------------------------------------------
  // 2. Score out of range rejects job
  // -------------------------------------------------------------------------

  test('score out of range rejects job', async () => {
    const job = createGatedJob({ id: 20 });
    mockedCallDeepSeek.mockRejectedValue(
      new deepseekClient.LlmSchemaError('score', 'number (>= 1, <= 10)', '15'),
    );

    const result: Stage5Result = await scoreJobs([job], defaultProfile);

    expect(result.scoredJobs).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(20);
    expect(result.rejected[0].rejectedAtStage).toBe(5);
    expect(result.rejected[0].reason).toMatch(/score/i);
  });

  // -------------------------------------------------------------------------
  // 3. Missing reasoning rejects job
  // -------------------------------------------------------------------------

  test('missing reasoning rejects job', async () => {
    const job = createGatedJob({ id: 30 });
    mockedCallDeepSeek.mockRejectedValue(
      new deepseekClient.LlmSchemaError(
        'scoreReasoning',
        'non-empty string',
        'empty string',
      ),
    );

    const result: Stage5Result = await scoreJobs([job], defaultProfile);

    expect(result.scoredJobs).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(30);
    expect(result.rejected[0].rejectedAtStage).toBe(5);
    expect(result.rejected[0].reason).toMatch(/scoreReasoning/i);
  });

  // -------------------------------------------------------------------------
  // 4. API error on one job continues others
  // -------------------------------------------------------------------------

  test('API error on one job continues others', async () => {
    const jobFail = createGatedJob({ id: 40 });
    const jobPass = createGatedJob({ id: 41 });

    mockedCallDeepSeek
      .mockRejectedValueOnce(new deepseekClient.LlmApiError('Rate limit hit', 429))
      .mockResolvedValueOnce({
        content: JSON.stringify({
          score: 7,
          scoreReasoning: 'Good overall match',
        }),
        model: 'deepseek-chat',
        usage: { promptTokens: 140, completionTokens: 25 },
      });

    const result: Stage5Result = await scoreJobs([jobFail, jobPass], defaultProfile);

    expect(result.scoredJobs).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);

    expect(result.scoredJobs[0].id).toBe(41);
    expect(result.scoredJobs[0].score).toBe(7);

    expect(result.rejected[0].id).toBe(40);
    expect(result.rejected[0].rejectedAtStage).toBe(5);
    expect(result.rejected[0].reason).toMatch(/rate limit/i);
  });

  // -------------------------------------------------------------------------
  // 5. Results sorted descending
  // -------------------------------------------------------------------------

  test('results sorted descending', async () => {
    const jobLow = createGatedJob({ id: 1, title: 'Junior Dev' });
    const jobMid = createGatedJob({ id: 2, title: 'Mid Dev' });
    const jobHigh = createGatedJob({ id: 3, title: 'Senior Dev' });

    mockedCallDeepSeek
      .mockResolvedValueOnce({
        content: JSON.stringify({ score: 4, scoreReasoning: 'Weak match' }),
        model: 'deepseek-chat',
        usage: { promptTokens: 100, completionTokens: 20 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ score: 7, scoreReasoning: 'Decent match' }),
        model: 'deepseek-chat',
        usage: { promptTokens: 110, completionTokens: 22 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ score: 9, scoreReasoning: 'Excellent match' }),
        model: 'deepseek-chat',
        usage: { promptTokens: 120, completionTokens: 24 },
      });

    const result: Stage5Result = await scoreJobs(
      [jobLow, jobMid, jobHigh],
      defaultProfile,
    );

    expect(result.scoredJobs).toHaveLength(3);
    expect(result.rejected).toHaveLength(0);

    // Scores should be descending: 9, 7, 4
    expect(result.scoredJobs[0].id).toBe(3);
    expect(result.scoredJobs[0].score).toBe(9);

    expect(result.scoredJobs[1].id).toBe(2);
    expect(result.scoredJobs[1].score).toBe(7);

    expect(result.scoredJobs[2].id).toBe(1);
    expect(result.scoredJobs[2].score).toBe(4);
  });

  // -------------------------------------------------------------------------
  // 6. Stats reflect total call count
  // -------------------------------------------------------------------------

  test('stats reflect total call count', async () => {
    const job1 = createGatedJob({ id: 1 });
    const job2 = createGatedJob({ id: 2 });
    const job3 = createGatedJob({ id: 3 });

    // Two succeed, one fails
    mockedCallDeepSeek
      .mockResolvedValueOnce({
        content: JSON.stringify({ score: 8, scoreReasoning: 'Great match' }),
        model: 'deepseek-chat',
        usage: { promptTokens: 150, completionTokens: 30 },
      })
      .mockRejectedValueOnce(new deepseekClient.LlmApiError('Timeout', 0))
      .mockResolvedValueOnce({
        content: JSON.stringify({ score: 6, scoreReasoning: 'Adequate match' }),
        model: 'deepseek-chat',
        usage: { promptTokens: 160, completionTokens: 35 },
      });

    const result: Stage5Result = await scoreJobs(
      [job1, job2, job3],
      defaultProfile,
    );

    expect(result.scoredJobs).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);

    expect(result.stats.totalJobsScored).toBe(2);
    expect(result.stats.totalJobsRejected).toBe(1);
    expect(result.stats.totalLlmCalls).toBe(3);
    // 2 successful calls: 150 + 160 = 310 prompt tokens, 30 + 35 = 65 completion tokens → 375 total
    expect(result.stats.llmTokensUsed).toBe(375);
    expect(result.stats.estimatedCostUsd).toBeGreaterThan(0);
    expect(result.stats.estimatedCostUsd).toBeLessThan(0.001);
  });
});
