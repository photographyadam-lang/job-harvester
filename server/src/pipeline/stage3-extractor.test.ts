/**
 * Stage 3b — Extractor tests
 *
 * @jest-environment node
 */

import { extractJobs } from './stage3-extractor';
import * as normalizer from './normalizer';
import * as deepseekClient from '../llm/deepseekClient';
import { extractionSchema } from '../llm/schemaValidator';
import type { CompanyConfig } from '../config/types';
import type {
  FilteredJob,
  Stage3Result,
} from '../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Spy on normalizer and deepseekClient rather than auto-mocking, so that
// error classes (NormalizationError, LlmSchemaError, LlmApiError) remain
// real classes that work with instanceof checks in the implementation.
const mockedNormalizeJobHtml = jest
  .spyOn(normalizer, 'normalizeJobHtml')
  .mockReturnValue({ markdown: '', truncated: false });

const mockedCallDeepSeek = jest
  .spyOn(deepseekClient, 'callDeepSeek')
  .mockRejectedValue(new Error('unexpected call'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal FilteredJob with sensible defaults.
 */
function createFilteredJob(
  overrides: Partial<FilteredJob> = {},
): FilteredJob {
  return {
    id: overrides.id ?? 100,
    title: overrides.title ?? 'Software Engineer',
    content: overrides.content ?? '<p>Original HTML</p>',
    location: overrides.location ?? 'San Francisco, CA',
    department: overrides.department ?? 'Engineering',
    url: overrides.url ?? 'https://boards.greenhouse.io/figma/jobs/100',
    matchReason: overrides.matchReason ?? 'test match reason',
  };
}

/**
 * Default company config matching the Figma fixture shape.
 */
const baseConfig: CompanyConfig = {
  name: 'Figma',
  departments: ['Engineering', 'Product', 'Design'],
  location: 'San Francisco',
  keyword: 'Engineer',
  descriptionKeyword: '',
  boardToken: '',
  sectionHeaders: {
    must_have: ['About the role', "What you'll do"],
    nice_to_have: ['Nice to have'],
  },
};

/**
 * Normalized markdown that contains both must_have and nice_to_have sections.
 */
const markdownWithBothSections = `
### What you'll do
* Design and build user interfaces
* Collaborate with product teams
### Nice to have
* Experience with Figma
* Knowledge of design systems
`.trim();

/**
 * Normalized markdown that contains only the must_have section.
 */
const _markdownWithMustHavesOnly = `
### What you'll do
* Design and build user interfaces
* Collaborate with product teams
`.trim();

/**
 * Normalized markdown with no matching section headers (triggers LLM fallback).
 */
const markdownWithNoHeaders = `
We are looking for a talented engineer to join our team.
You will work on exciting projects and collaborate with cross-functional teams.
`.trim();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

describe('extractJobs', () => {
  // -------------------------------------------------------------------------
  // 1. Heuristic hit extracts must-haves
  // -------------------------------------------------------------------------

  test('heuristic hit extracts must-haves and nice-to-haves', async () => {
    const job = createFilteredJob();
    mockedNormalizeJobHtml.mockReturnValue({
      markdown: markdownWithBothSections,
      truncated: false,
    });

    const result: Stage3Result = await extractJobs([job], baseConfig, 'Figma');

    expect(result.passed).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);

    const extracted = result.passed[0];
    expect(extracted.requirements.must_haves).toEqual([
      'Design and build user interfaces',
      'Collaborate with product teams',
    ]);
    expect(extracted.requirements.nice_to_haves).toEqual([
      'Experience with Figma',
      'Knowledge of design systems',
    ]);
  });

  // -------------------------------------------------------------------------
  // 2. Heuristic hit does NOT call DeepSeek
  // -------------------------------------------------------------------------

  test('heuristic hit does NOT call DeepSeek', async () => {
    const job = createFilteredJob();
    mockedNormalizeJobHtml.mockReturnValue({
      markdown: markdownWithBothSections,
      truncated: false,
    });

    await extractJobs([job], baseConfig, 'Figma');

    expect(mockedCallDeepSeek).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. Heuristic miss triggers DeepSeek
  // -------------------------------------------------------------------------

  test('heuristic miss triggers DeepSeek', async () => {
    const job = createFilteredJob();
    mockedNormalizeJobHtml.mockReturnValue({
      markdown: markdownWithNoHeaders,
      truncated: false,
    });
    mockedCallDeepSeek.mockResolvedValue({
      content: JSON.stringify({
        must_haves: ['JavaScript', 'React'],
        nice_to_haves: ['GraphQL'],
        years_experience_required: 3,
      }),
      model: 'deepseek-chat',
      usage: { promptTokens: 100, completionTokens: 50 },
    });

    await extractJobs([job], baseConfig, 'Figma');

    expect(mockedCallDeepSeek).toHaveBeenCalledTimes(1);
    expect(mockedCallDeepSeek).toHaveBeenCalledWith(
      expect.stringContaining(markdownWithNoHeaders),
      extractionSchema,
      expect.objectContaining({ systemPrompt: expect.any(String) }),
    );
  });

  // -------------------------------------------------------------------------
  // 4. Valid LLM schema passes
  // -------------------------------------------------------------------------

  test('valid LLM schema passes', async () => {
    const job = createFilteredJob({ id: 200 });
    mockedNormalizeJobHtml.mockReturnValue({
      markdown: markdownWithNoHeaders,
      truncated: false,
    });
    mockedCallDeepSeek.mockResolvedValue({
      content: JSON.stringify({
        must_haves: ['TypeScript', 'Node.js'],
        nice_to_haves: ['Docker'],
        years_experience_required: 5,
      }),
      model: 'deepseek-chat',
      usage: { promptTokens: 90, completionTokens: 40 },
    });

    const result = await extractJobs([job], baseConfig, 'Figma');

    expect(result.passed).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.passed[0].id).toBe(200);
    expect(result.passed[0].requirements.must_haves).toEqual(['TypeScript', 'Node.js']);
    expect(result.passed[0].requirements.nice_to_haves).toEqual(['Docker']);
  });

  // -------------------------------------------------------------------------
  // 5. LLM schema error rejects job
  // -------------------------------------------------------------------------

  test('LLM schema error rejects job', async () => {
    const job = createFilteredJob({ id: 300 });
    mockedNormalizeJobHtml.mockReturnValue({
      markdown: markdownWithNoHeaders,
      truncated: false,
    });
    mockedCallDeepSeek.mockRejectedValue(
      new deepseekClient.LlmSchemaError('must_haves', 'array of strings', 'undefined'),
    );

    const result = await extractJobs([job], baseConfig, 'Figma');

    expect(result.passed).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(300);
    expect(result.rejected[0].rejectedAtStage).toBe(3);
    expect(result.rejected[0].reason).toMatch(/must_haves/i);
  });

  // -------------------------------------------------------------------------
  // 6. LLM API error rejects job
  // -------------------------------------------------------------------------

  test('LLM API error rejects job', async () => {
    const job = createFilteredJob({ id: 400 });
    mockedNormalizeJobHtml.mockReturnValue({
      markdown: markdownWithNoHeaders,
      truncated: false,
    });
    mockedCallDeepSeek.mockRejectedValue(new deepseekClient.LlmApiError('Rate limit exceeded', 429));

    const result = await extractJobs([job], baseConfig, 'Figma');

    expect(result.passed).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(400);
    expect(result.rejected[0].rejectedAtStage).toBe(3);
    expect(result.rejected[0].reason).toMatch(/rate limit/i);
  });

  // -------------------------------------------------------------------------
  // 7. Normalization error rejects job
  // -------------------------------------------------------------------------

  test('normalization error rejects job', async () => {
    const job = createFilteredJob({ id: 500 });
    mockedNormalizeJobHtml.mockImplementation(() => {
      throw new normalizer.NormalizationError('normalizeJobHtml produced empty output from the provided HTML');
    });

    const result = await extractJobs([job], baseConfig, 'Figma');

    expect(result.passed).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].id).toBe(500);
    expect(result.rejected[0].rejectedAtStage).toBe(3);
    expect(result.rejected[0].reason).toMatch(/normaliz/i);
  });

  // -------------------------------------------------------------------------
  // 8. Stats count correctly
  // -------------------------------------------------------------------------

  test('stats count correctly', async () => {
    // Two heuristic hits + one LLM fallback
    const jobHeuristic1 = createFilteredJob({ id: 1, url: 'https://example.com/jobs/1' });
    const jobHeuristic2 = createFilteredJob({ id: 2, url: 'https://example.com/jobs/2' });
    const jobLLM = createFilteredJob({ id: 3, url: 'https://example.com/jobs/3' });

    mockedNormalizeJobHtml
      .mockReturnValueOnce({ markdown: markdownWithBothSections, truncated: false })
      .mockReturnValueOnce({ markdown: markdownWithBothSections, truncated: false })
      .mockReturnValueOnce({ markdown: markdownWithNoHeaders, truncated: false });

    mockedCallDeepSeek.mockResolvedValue({
      content: JSON.stringify({
        must_haves: ['Go', 'Kubernetes'],
        nice_to_haves: ['AWS'],
        years_experience_required: null,
      }),
      model: 'deepseek-chat',
      usage: { promptTokens: 200, completionTokens: 80 },
    });

    const result = await extractJobs(
      [jobHeuristic1, jobHeuristic2, jobLLM],
      baseConfig,
      'Figma',
    );

    expect(result.passed).toHaveLength(3);
    expect(result.stats.heuristicHits).toBe(2);
    expect(result.stats.llmFallbacks).toBe(1);
    expect(result.stats.llmTokensUsed).toBe(280); // 200 + 80 from one LLM call
    expect(result.stats.estimatedCostUsd).toBeGreaterThan(0);
    expect(result.stats.estimatedCostUsd).toBeLessThan(0.001);
  });

  // -------------------------------------------------------------------------
  // 9. Extracted job inherits URL from FilteredJob
  // -------------------------------------------------------------------------

  test('extracted job inherits URL from FilteredJob', async () => {
    const job = createFilteredJob({
      url: 'https://boards.greenhouse.io/figma/jobs/42',
    });
    mockedNormalizeJobHtml.mockReturnValue({
      markdown: markdownWithBothSections,
      truncated: false,
    });

    const result = await extractJobs([job], baseConfig, 'Figma');

    expect(result.passed[0].url).toBe('https://boards.greenhouse.io/figma/jobs/42');
  });

  // -------------------------------------------------------------------------
  // 10. Both sections extracted when both headers present
  // -------------------------------------------------------------------------

  test('both sections extracted when both headers present', async () => {
    const markdown = `
### About the role
* Lead frontend architecture decisions
* Mentor junior developers
### Nice to have
* Experience with Storybook
* Familiarity with CI/CD pipelines
`.trim();

    const job = createFilteredJob();
    mockedNormalizeJobHtml.mockReturnValue({
      markdown,
      truncated: false,
    });

    const result = await extractJobs([job], baseConfig, 'Figma');

    expect(result.passed[0].requirements.must_haves).toEqual([
      'Lead frontend architecture decisions',
      'Mentor junior developers',
    ]);
    expect(result.passed[0].requirements.nice_to_haves).toEqual([
      'Experience with Storybook',
      'Familiarity with CI/CD pipelines',
    ]);
  });

  // -------------------------------------------------------------------------
  // 11. Null years-experience when absent
  // -------------------------------------------------------------------------

  test('null years-experience when absent', async () => {
    const job = createFilteredJob();
    mockedNormalizeJobHtml.mockReturnValue({
      markdown: markdownWithNoHeaders,
      truncated: false,
    });
    mockedCallDeepSeek.mockResolvedValue({
      content: JSON.stringify({
        must_haves: ['Python'],
        nice_to_haves: [],
        years_experience_required: null,
      }),
      model: 'deepseek-chat',
      usage: { promptTokens: 50, completionTokens: 20 },
    });

    const result = await extractJobs([job], baseConfig, 'Figma');

    expect(result.passed).toHaveLength(1);
    // years_experience_required is not part of ExtractedRequirements, so we
    // just verify the LLM was called and the job passed.
    // The LLM response had years_experience_required: null → valid per schema.
    expect(mockedCallDeepSeek).toHaveBeenCalledTimes(1);
  });
});
