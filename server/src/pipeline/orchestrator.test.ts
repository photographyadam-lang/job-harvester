/**
 * Pipeline Orchestrator tests
 *
 * All stage functions, config loaders, dedup cache, and persister are mocked.
 * No real stage logic runs in these tests.
 *
 * @jest-environment node
 */

import { runPipeline } from './orchestrator';
import type {
  PipelineEvent,
  EmitCallback,
  PipelineRunOutput,
  ReportCard,
  StageResult,
  Stage3Result,
  Stage5Result,
  FilteredJob,
  ExtractedJob,
  GatedJob,
  ScoredJob,
  RejectedJob,
  RawJob,
} from '../types';
import type { CompanyConfig, SkillsProfile } from '../config/types';

// ---------------------------------------------------------------------------
// Mocks — factory functions preserve real Error classes for instanceof checks
// ---------------------------------------------------------------------------

jest.mock('./stage1-fetch', () => ({
  fetchJobs: jest.fn(),
}));

jest.mock('./stage2-filter', () => {
  class MockConfigMismatchError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ConfigMismatchError';
    }
  }
  return {
    filterJobs: jest.fn(),
    ConfigMismatchError: MockConfigMismatchError,
  };
});

jest.mock('./stage3-extractor', () => ({
  extractJobs: jest.fn(),
}));

jest.mock('./stage4-gap-filter', () => ({
  filterByGap: jest.fn(),
}));

jest.mock('./stage5-scorer', () => ({
  scoreJobs: jest.fn(),
}));

jest.mock('../output/dedupCache', () => ({
  isProcessed: jest.fn(),
  markProcessed: jest.fn(),
}));

jest.mock('../output/runPersister', () => ({
  persistRun: jest.fn().mockReturnValue('/mock/output/file.json'),
}));

jest.mock('../config/companyConfig', () => ({
  loadCompanyConfig: jest.fn(),
}));

jest.mock('../config/skillsProfile', () => ({
  loadSkillsProfile: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocks with their real types
// ---------------------------------------------------------------------------

import { fetchJobs } from './stage1-fetch';
import { filterJobs, ConfigMismatchError } from './stage2-filter';
import { extractJobs } from './stage3-extractor';
import { filterByGap } from './stage4-gap-filter';
import { scoreJobs } from './stage5-scorer';
import { isProcessed, markProcessed } from '../output/dedupCache';
import { persistRun } from '../output/runPersister';
import { loadCompanyConfig } from '../config/companyConfig';
import { loadSkillsProfile } from '../config/skillsProfile';

const mockFetchJobs = fetchJobs as jest.Mock;
const mockFilterJobs = filterJobs as jest.Mock;
const mockExtractJobs = extractJobs as jest.Mock;
const mockFilterByGap = filterByGap as jest.Mock;
const mockScoreJobs = scoreJobs as jest.Mock;
const mockIsProcessed = isProcessed as jest.Mock;
const mockMarkProcessed = markProcessed as jest.Mock;
const mockPersistRun = persistRun as jest.Mock;
const mockLoadCompanyConfig = loadCompanyConfig as jest.Mock;
const mockLoadSkillsProfile = loadSkillsProfile as jest.Mock;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const mockCompanyConfig: CompanyConfig = {
  name: 'Figma',
  departments: ['Engineering', 'Product', 'Design'],
  location: 'San Francisco',
  keyword: 'Engineer',
  sectionHeaders: {
    must_have: ['About the role', "What you'll do"],
    nice_to_have: ['Nice to have'],
  },
};

const mockSkillsProfile: SkillsProfile = {
  skills: [
    { name: 'TypeScript', strength: 'must_have' },
    { name: 'React', strength: 'must_have' },
  ],
  gapThreshold: 0.5,
};

function createRawJob(overrides: Partial<RawJob> = {}): RawJob {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? 'Software Engineer',
    content: overrides.content ?? '<p>Job description</p>',
    location: { name: overrides.location?.name ?? 'San Francisco, CA' },
    department: { name: overrides.department?.name ?? 'Engineering' },
    absolute_url:
      overrides.absolute_url ?? 'https://boards.greenhouse.io/figma/jobs/1',
  };
}

function createFilteredJob(overrides: Partial<FilteredJob> = {}): FilteredJob {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? 'Software Engineer',
    content: overrides.content ?? '<p>Job description</p>',
    location: overrides.location ?? 'San Francisco, CA',
    department: overrides.department ?? 'Engineering',
    url:
      overrides.url ?? 'https://boards.greenhouse.io/figma/jobs/1',
  };
}

function createExtractedJob(
  overrides: Partial<ExtractedJob> = {},
): ExtractedJob {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? 'Software Engineer',
    content: overrides.content ?? '<p>Job description</p>',
    location: overrides.location ?? 'San Francisco, CA',
    department: overrides.department ?? 'Engineering',
    url:
      overrides.url ?? 'https://boards.greenhouse.io/figma/jobs/1',
    requirements: overrides.requirements ?? {
      must_haves: ['TypeScript', 'React'],
      nice_to_haves: ['Docker'],
    },
  };
}

function createGatedJob(overrides: Partial<GatedJob> = {}): GatedJob {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? 'Software Engineer',
    content: overrides.content ?? '<p>Job description</p>',
    location: overrides.location ?? 'San Francisco, CA',
    department: overrides.department ?? 'Engineering',
    url:
      overrides.url ?? 'https://boards.greenhouse.io/figma/jobs/1',
    requirements: overrides.requirements ?? {
      must_haves: ['TypeScript', 'React'],
      nice_to_haves: ['Docker'],
    },
    gapRatio: overrides.gapRatio ?? 0.2,
    matchedSkills: overrides.matchedSkills ?? ['TypeScript', 'React'],
    unmatchedSkills: overrides.unmatchedSkills ?? [],
  };
}

function createScoredJob(overrides: Partial<ScoredJob> = {}): ScoredJob {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? 'Software Engineer',
    content: overrides.content ?? '<p>Job description</p>',
    location: overrides.location ?? 'San Francisco, CA',
    department: overrides.department ?? 'Engineering',
    url:
      overrides.url ?? 'https://boards.greenhouse.io/figma/jobs/1',
    requirements: overrides.requirements ?? {
      must_haves: ['TypeScript', 'React'],
      nice_to_haves: ['Docker'],
    },
    gapRatio: overrides.gapRatio ?? 0.2,
    matchedSkills: overrides.matchedSkills ?? ['TypeScript', 'React'],
    unmatchedSkills: overrides.unmatchedSkills ?? [],
    score: overrides.score ?? 8,
    scoreReasoning:
      overrides.scoreReasoning ?? 'Strong match on core technologies.',
  };
}

function createRejectedJob(
  overrides: Partial<RejectedJob> = {},
): RejectedJob {
  return {
    id: overrides.id ?? 99,
    title: overrides.title ?? 'Rejected Job',
    url: overrides.url ?? 'https://boards.greenhouse.io/figma/jobs/99',
    rejectedAtStage: overrides.rejectedAtStage ?? 2,
    reason:
      overrides.reason ?? 'Rejected by location filter: "Remote" does not match "San Francisco"',
  };
}

// ---------------------------------------------------------------------------
// Shared test setup
// ---------------------------------------------------------------------------

let emittedEvents: PipelineEvent[];
let emitSpy: EmitCallback;

beforeEach(() => {
  jest.clearAllMocks();

  // Default mock setup — happy path
  mockLoadCompanyConfig.mockReturnValue(mockCompanyConfig);
  mockLoadSkillsProfile.mockReturnValue(mockSkillsProfile);

  // Stage 1 — fetch returns one job
  const rawJob = createRawJob();
  mockFetchJobs.mockResolvedValue({ jobs: [rawJob], rawCount: 1 });

  // Stage 2 — filter passes the job
  const filteredJob = createFilteredJob();
  mockFilterJobs.mockReturnValue({
    passed: [filteredJob],
    rejected: [],
  } satisfies StageResult<FilteredJob>);

  // No dedup — all jobs are new
  mockIsProcessed.mockReturnValue(false);

  // Stage 3 — extract returns passed job
  const extractedJob = createExtractedJob();
  mockExtractJobs.mockResolvedValue({
    passed: [extractedJob],
    rejected: [],
    stats: { heuristicHits: 1, llmFallbacks: 0, llmTokensUsed: 100, estimatedCostUsd: 0.002 },
  } satisfies Stage3Result);

  // Stage 4 — gap filter passes
  const gatedJob = createGatedJob();
  mockFilterByGap.mockReturnValue({
    passed: [gatedJob],
    rejected: [],
  } satisfies StageResult<GatedJob>);

  // Stage 5 — scorer returns scored job
  const scoredJob = createScoredJob();
  mockScoreJobs.mockResolvedValue({
    scoredJobs: [scoredJob],
    rejected: [],
    stats: { totalJobsScored: 1, totalJobsRejected: 0, totalLlmCalls: 1, llmTokensUsed: 200, estimatedCostUsd: 0.004 },
  } satisfies Stage5Result);

  // Event collector
  emittedEvents = [];
  emitSpy = (event: PipelineEvent) => {
    emittedEvents.push(event);
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runPipeline', () => {
  // -------------------------------------------------------------------------
  // 1. Stages called in order 1→2→3→4→5
  // -------------------------------------------------------------------------

  test('stages called in order 1→2→3→4→5', async () => {
    await runPipeline('figma', emitSpy);

    // Verify each stage function was called exactly once
    expect(mockFetchJobs).toHaveBeenCalledTimes(1);
    expect(mockFetchJobs).toHaveBeenCalledWith('figma');

    expect(mockFilterJobs).toHaveBeenCalledTimes(1);
    // Stage 2 receives raw jobs from Stage 1
    expect(mockFilterJobs).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 1 })]),
      expect.objectContaining({
        location: 'San Francisco',
        departments: ['Engineering', 'Product', 'Design'],
        keyword: 'Engineer',
      }),
    );

    expect(mockExtractJobs).toHaveBeenCalledTimes(1);
    expect(mockExtractJobs).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 1 })]),
      mockCompanyConfig,
      'Figma',
    );

    expect(mockFilterByGap).toHaveBeenCalledTimes(1);
    expect(mockFilterByGap).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 1 })]),
      mockSkillsProfile,
    );

    expect(mockScoreJobs).toHaveBeenCalledTimes(1);
    expect(mockScoreJobs).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 1 })]),
      mockSkillsProfile,
    );

    // Verify call order using mock.invocationCallOrder
    const fetchOrder = mockFetchJobs.mock.invocationCallOrder[0];
    const filterOrder = mockFilterJobs.mock.invocationCallOrder[0];
    const extractOrder = mockExtractJobs.mock.invocationCallOrder[0];
    const gapOrder = mockFilterByGap.mock.invocationCallOrder[0];
    const scoreOrder = mockScoreJobs.mock.invocationCallOrder[0];

    expect(fetchOrder).toBeLessThan(filterOrder!);
    expect(filterOrder!).toBeLessThan(extractOrder!);
    expect(extractOrder!).toBeLessThan(gapOrder!);
    expect(gapOrder!).toBeLessThan(scoreOrder!);
  });

  // -------------------------------------------------------------------------
  // 2. stage-start and stage-complete emitted per stage
  // -------------------------------------------------------------------------

  test('stage-start and stage-complete emitted per stage', async () => {
    await runPipeline('figma', emitSpy);

    const startEvents = emittedEvents.filter((e) => e.type === 'stage-start');
    const completeEvents = emittedEvents.filter(
      (e) => e.type === 'stage-complete',
    );

    expect(startEvents).toHaveLength(5);
    expect(completeEvents).toHaveLength(5);

    // Verify stage numbers 1–5
    const startStages = startEvents.map((e) => (e as any).stage);
    expect(startStages).toEqual([1, 2, 3, 4, 5]);

    const completeStages = completeEvents.map((e) => (e as any).stage);
    expect(completeStages).toEqual([1, 2, 3, 4, 5]);

    // Verify labels
    expect(startEvents[0]).toMatchObject({
      type: 'stage-start',
      stage: 1,
      label: 'Fetch jobs',
    });
    expect(startEvents[1]).toMatchObject({
      type: 'stage-start',
      stage: 2,
      label: 'Metadata filter',
    });
    expect(startEvents[2]).toMatchObject({
      type: 'stage-start',
      stage: 3,
      label: 'Extract requirements',
    });
    expect(startEvents[3]).toMatchObject({
      type: 'stage-start',
      stage: 4,
      label: 'Gap filter',
    });
    expect(startEvents[4]).toMatchObject({
      type: 'stage-start',
      stage: 5,
      label: 'Score jobs',
    });
  });

  // -------------------------------------------------------------------------
  // 3. job-passed events emitted
  // -------------------------------------------------------------------------

  test('job-passed events emitted', async () => {
    await runPipeline('figma', emitSpy);

    const passedEvents = emittedEvents.filter((e) => e.type === 'job-passed');

    // One job passes each of the 5 stages
    expect(passedEvents).toHaveLength(5);

    // Each event has the correct job info
    for (const event of passedEvents) {
      expect(event.type).toBe('job-passed');
      if (event.type === 'job-passed') {
        expect(event.job.id).toBe(1);
        expect(event.job.title).toBe('Software Engineer');
        expect(event.job.url).toContain('greenhouse.io');
      }
    }

    // Verify stage distribution
    const stagesWithPassed = passedEvents.map((e) => (e as any).stage);
    expect(stagesWithPassed).toEqual([1, 2, 3, 4, 5]);
  });

  // -------------------------------------------------------------------------
  // 4. job-rejected events emitted
  // -------------------------------------------------------------------------

  test('job-rejected events emitted', async () => {
    // Make Stage 2 reject one job and Stage 3 reject another
    const rejectedJob2 = createRejectedJob({
      id: 98,
      title: 'Rejected at Stage 2',
      rejectedAtStage: 2,
      reason: 'Rejected by department filter',
    });
    const rejectedJob3 = createRejectedJob({
      id: 97,
      title: 'Rejected at Stage 3',
      rejectedAtStage: 3,
      reason: 'Normalization error: empty content',
    });

    // Stage 2: pass one, reject one
    const filteredJob = createFilteredJob({ id: 1 });
    mockFilterJobs.mockReturnValue({
      passed: [filteredJob],
      rejected: [rejectedJob2],
    } satisfies StageResult<FilteredJob>);

    // Stage 3: pass one, reject one
    const extractedJob = createExtractedJob({ id: 1 });
    mockExtractJobs.mockResolvedValue({
      passed: [extractedJob],
      rejected: [rejectedJob3],
      stats: { heuristicHits: 0, llmFallbacks: 1, llmTokensUsed: 100, estimatedCostUsd: 0.002 },
    } satisfies Stage3Result);

    await runPipeline('figma', emitSpy);

    const rejectedEvents = emittedEvents.filter(
      (e) => e.type === 'job-rejected',
    );

    // We expect: 1 from stage 2 + 1 from stage 3 = 2
    expect(rejectedEvents).toHaveLength(2);

    // Verify the first rejected event (stage 2)
    const stage2Rejected = rejectedEvents.find(
      (e) => e.type === 'job-rejected' && e.stage === 2,
    );
    expect(stage2Rejected).toBeDefined();
    if (stage2Rejected?.type === 'job-rejected') {
      expect(stage2Rejected.job.id).toBe(98);
      expect(stage2Rejected.job.rejectedAtStage).toBe(2);
      expect(stage2Rejected.job.reason).toContain('department filter');
    }

    // Verify the second rejected event (stage 3)
    const stage3Rejected = rejectedEvents.find(
      (e) => e.type === 'job-rejected' && e.stage === 3,
    );
    expect(stage3Rejected).toBeDefined();
    if (stage3Rejected?.type === 'job-rejected') {
      expect(stage3Rejected.job.id).toBe(97);
      expect(stage3Rejected.job.rejectedAtStage).toBe(3);
      expect(stage3Rejected.job.reason).toContain('empty content');
    }
  });

  // -------------------------------------------------------------------------
  // 5. Dedup skips processed jobs
  // -------------------------------------------------------------------------

  test('dedup skips processed jobs', async () => {
    // Stage 2 passes two jobs
    const job1 = createFilteredJob({ id: 1, title: 'First Job' });
    const job2 = createFilteredJob({ id: 2, title: 'Second Job' });
    mockFilterJobs.mockReturnValue({
      passed: [job1, job2],
      rejected: [],
    } satisfies StageResult<FilteredJob>);

    // Job 1 is already processed, Job 2 is new
    mockIsProcessed.mockImplementation((jobId: number) => jobId === 1);

    await runPipeline('figma', emitSpy);

    // Verify that only job 2 was passed to extractJobs (Stage 3)
    expect(mockExtractJobs).toHaveBeenCalledWith(
      [job2], // only the unprocessed job
      expect.anything(),
      expect.anything(),
    );

    // Verify a job-rejected event was emitted for the deduped job
    const rejectedEvents = emittedEvents.filter(
      (e) => e.type === 'job-rejected',
    );
    expect(rejectedEvents).toHaveLength(1);

    const dedupEvent = rejectedEvents[0];
    if (dedupEvent?.type === 'job-rejected') {
      expect(dedupEvent.stage).toBe(3);
      expect(dedupEvent.job.id).toBe(1);
      expect(dedupEvent.job.rejectedAtStage).toBe(3);
      expect(dedupEvent.job.reason).toBe('Already processed');
    }

    // Verify isProcessed was called for both jobs
    expect(mockIsProcessed).toHaveBeenCalledWith(1);
    expect(mockIsProcessed).toHaveBeenCalledWith(2);
  });

  // -------------------------------------------------------------------------
  // 6. run-complete emits ReportCard
  // -------------------------------------------------------------------------

  test('run-complete emits ReportCard', async () => {
    await runPipeline('figma', emitSpy);

    const completeEvent = emittedEvents.find(
      (e) => e.type === 'run-complete',
    );

    expect(completeEvent).toBeDefined();
    expect(completeEvent?.type).toBe('run-complete');

    if (completeEvent?.type === 'run-complete') {
      const rc: ReportCard = completeEvent.reportCard;

      // 5 stage reports
      expect(rc.stages).toHaveLength(5);
      expect(rc.stages[0].stage).toBe(1);
      expect(rc.stages[1].stage).toBe(2);
      expect(rc.stages[2].stage).toBe(3);
      expect(rc.stages[3].stage).toBe(4);
      expect(rc.stages[4].stage).toBe(5);

      // All have non-negative counts
      for (const sr of rc.stages) {
        expect(sr.passedCount).toBeGreaterThanOrEqual(0);
        expect(sr.rejectedCount).toBeGreaterThanOrEqual(0);
      }

      // Total counts
      expect(rc.totalPassed).toBeGreaterThan(0);
      expect(rc.totalRejected).toBe(0); // happy path, no rejects
      expect(rc.totalRuntimeMs).toBeGreaterThanOrEqual(0);
      expect(rc.estimatedCostUsd).toBeGreaterThanOrEqual(0);
    }
  });

  // -------------------------------------------------------------------------
  // 7. ConfigMismatchError emits run-error and rethrows
  // -------------------------------------------------------------------------

  test('ConfigMismatchError emits run-error', async () => {
    // Stage 2 throws ConfigMismatchError
    mockFilterJobs.mockImplementation(() => {
      throw new ConfigMismatchError(
        'Zero jobs survived Stage 2 (metadata filter). Check your filter config.',
      );
    });

    // The pipeline should reject
    await expect(runPipeline('figma', emitSpy)).rejects.toThrow(
      ConfigMismatchError,
    );

    // Verify run-error event was emitted
    const errorEvent = emittedEvents.find((e) => e.type === 'run-error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.type).toBe('run-error');

    if (errorEvent?.type === 'run-error') {
      expect(errorEvent.stage).toBe(2);
      expect(errorEvent.error).toContain('Zero jobs survived Stage 2');

      // Verify no events beyond the error were emitted
      const errorIndex = emittedEvents.indexOf(errorEvent);
      const eventsAfterError = emittedEvents.slice(errorIndex + 1);
      expect(eventsAfterError).toHaveLength(0);
    }

    // Verify no stage beyond 2 was called
    expect(mockExtractJobs).not.toHaveBeenCalled();
    expect(mockFilterByGap).not.toHaveBeenCalled();
    expect(mockScoreJobs).not.toHaveBeenCalled();
    expect(mockPersistRun).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. persistRun called on completion
  // -------------------------------------------------------------------------

  test('persistRun called on completion', async () => {
    await runPipeline('figma', emitSpy);

    // Must be called exactly once
    expect(mockPersistRun).toHaveBeenCalledTimes(1);

    // Verify the shape of the persisted data
    const persistedData = mockPersistRun.mock
      .calls[0][0] as PipelineRunOutput;
    expect(persistedData.companyToken).toBe('figma');
    expect(persistedData.status).toBe('complete');
    expect(persistedData.runAt).toBeDefined();
    expect(typeof persistedData.runAt).toBe('string');

    // Should have reportCard
    expect(persistedData.reportCard).toBeDefined();
    expect(persistedData.reportCard.stages).toHaveLength(5);

    // Should have scored jobs
    expect(persistedData.scoredJobs).toHaveLength(1);
    expect(persistedData.scoredJobs[0].score).toBe(8);

    // Should have rejected jobs (empty in happy path)
    expect(persistedData.rejectedJobs).toEqual([]);

    // Verify markProcessed was called for the scored job
    expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
    expect(mockMarkProcessed).toHaveBeenCalledWith(1);
  });
});
