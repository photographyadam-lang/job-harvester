/**
 * @jest-environment node
 *
 * Tests for the step orchestrator — stateful step-mode pipeline sessions.
 *
 * Rule 8: NO live HTTP/API calls — all stage functions are mocked.
 */

import {
  createStepSession,
  startStepSession,
  advanceStepSession,
  cancelStepSession,
  getStepSession,
} from './stepOrchestrator';
import { executeStage1, executeStage2, executeStage3, executeStage4, executeStage5 } from './orchestrator';
import { loadCompanyConfig, resolveBoardToken } from '../config/companyConfig';
import { loadSkillsProfile } from '../config/skillsProfile';
import { markProcessed } from '../output/dedupCache';
import { persistRun } from '../output/runPersister';
import type { Response } from 'express';
import type {
  RawJob,
  FilteredJob,
  ExtractedJob,
  GatedJob,
  RejectedJob,
  StageReport,
  EmitCallback,
  PipelineEvent,
  FilterConfig,
} from '../types';
import type { CompanyConfig, SkillsProfile } from '../config/types';

// ---------------------------------------------------------------------------
// Mocks (Jest-hoist-safe factory functions — no jest.fn() at module scope)
// ---------------------------------------------------------------------------

jest.mock('./orchestrator', () => ({
  executeStage1: jest.fn(),
  executeStage2: jest.fn(),
  executeStage3: jest.fn(),
  executeStage4: jest.fn(),
  executeStage5: jest.fn(),
}));

jest.mock('../config/companyConfig', () => ({
  loadCompanyConfig: jest.fn(),
  resolveBoardToken: jest.fn(),
}));

jest.mock('../config/skillsProfile', () => ({
  loadSkillsProfile: jest.fn(),
}));

jest.mock('../output/dedupCache', () => ({
  markProcessed: jest.fn(),
}));

jest.mock('../output/runPersister', () => ({
  persistRun: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRes(): Partial<Response> {
  return {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  };
}

function mockEmit(): { emit: EmitCallback; events: PipelineEvent[] } {
  const events: PipelineEvent[] = [];
  const emit: EmitCallback = (event) => {
    events.push(event);
  };
  return { emit, events };
}

// ---------------------------------------------------------------------------
// Stub data
// ---------------------------------------------------------------------------

const stubCompanyConfig: CompanyConfig = {
  name: 'TestCo',
  departments: ['Engineering', 'Design'],
  location: 'Remote',
  keyword: 'Engineer',
  descriptionKeyword: '',
  boardToken: '',
  sectionHeaders: {
    must_have: ['Requirements'],
    nice_to_have: ['Nice to Have'],
  },
};

const stubSkillsProfile: SkillsProfile = {
  skills: [{ name: 'TypeScript', strength: 'must_have' }],
  gapThreshold: 0.5,
};

const stubRawJob: RawJob = {
  id: 1,
  title: 'Software Engineer',
  content: '<p>Build great things</p>',
  location: { name: 'Remote' },
  department: { name: 'Engineering' },
  absolute_url: 'https://boards.greenhouse.io/testco/jobs/1',
  updated_at: '2026-01-01T00:00:00Z',
  first_published: '2025-01-01T00:00:00Z',
};

const stubFilteredJob: FilteredJob = {
  id: 1,
  title: 'Software Engineer',
  content: '<p>Build great things</p>',
  location: 'Remote',
  department: 'Engineering',
  url: 'https://boards.greenhouse.io/testco/jobs/1',
  matchReason: 'test match reason',
};

const stubExtractedJob: ExtractedJob = {
  ...stubFilteredJob,
  requirements: { must_haves: ['TypeScript'], nice_to_haves: ['Rust'] },
};

const stubGatedJob: GatedJob = {
  ...stubExtractedJob,
  gapRatio: 0.2,
  matchedSkills: ['TypeScript'],
  unmatchedSkills: ['Rust'],
};

const stubScoredJob = {
  ...stubGatedJob,
  score: 85,
  scoreReasoning: 'Good match',
};

const stubRejectedJob: RejectedJob = {
  id: 99,
  title: 'Rejected Job',
  url: 'https://example.com/job/99',
  rejectedAtStage: 2,
  reason: 'Wrong department',
};

const stubStageReport = (stage: 1 | 2 | 3 | 4 | 5, passed: number, rejected: number): StageReport => ({
  stage,
  passedCount: passed,
  rejectedCount: rejected,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stepOrchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // createStepSession
  // =========================================================================

  describe('createStepSession', () => {
    test('1. Creates session, loads configs, stores in Map', () => {
      const mockedLoadCompanyConfig = jest.mocked(loadCompanyConfig);
      const mockedLoadSkillsProfile = jest.mocked(loadSkillsProfile);
      mockedLoadCompanyConfig.mockReturnValue(stubCompanyConfig);
      mockedLoadSkillsProfile.mockReturnValue(stubSkillsProfile);

      const res = mockRes() as Response;
      const { emit } = mockEmit();

      createStepSession('testco', res, emit);

      expect(mockedLoadCompanyConfig).toHaveBeenCalledWith('testco');
      expect(mockedLoadSkillsProfile).toHaveBeenCalled();
      expect(getStepSession('testco')).toBeDefined();
      expect(getStepSession('testco')!.token).toBe('testco');
    });

    test('2. Replaces existing session for same token', () => {
      const mockedLoadCompanyConfig = jest.mocked(loadCompanyConfig);
      const mockedLoadSkillsProfile = jest.mocked(loadSkillsProfile);
      mockedLoadCompanyConfig.mockReturnValue(stubCompanyConfig);
      mockedLoadSkillsProfile.mockReturnValue(stubSkillsProfile);

      const res1 = mockRes() as Response;
      const res2 = mockRes() as Response;
      const { emit: emit1 } = mockEmit();
      const { emit: emit2 } = mockEmit();

      // First session
      createStepSession('testco', res1, emit1);
      expect(getStepSession('testco')).toBeDefined();

      // Second session with same token — should cancel first
      createStepSession('testco', res2, emit2);

      // First session's res.end should have been called by cancelStepSession
      expect(res1.end).toHaveBeenCalled();
      // Second session should be the active one
      expect(getStepSession('testco')).toBeDefined();
    });
  });

  // =========================================================================
  // startStepSession
  // =========================================================================

  describe('startStepSession', () => {
    test('3. Runs Stage 1 with resolved board token', async () => {
      const mockedLoadCompanyConfig = jest.mocked(loadCompanyConfig);
      const mockedLoadSkillsProfile = jest.mocked(loadSkillsProfile);
      const mockedResolveBoardToken = jest.mocked(resolveBoardToken);
      const mockedExecuteStage1 = jest.mocked(executeStage1);

      mockedLoadCompanyConfig.mockReturnValue(stubCompanyConfig);
      mockedLoadSkillsProfile.mockReturnValue(stubSkillsProfile);
      mockedResolveBoardToken.mockReturnValue('resolved-token');

      mockedExecuteStage1.mockResolvedValue({
        jobs: [stubRawJob],
        rawCount: 1,
        report: stubStageReport(1, 1, 0),
      });

      const res = mockRes() as Response;
      const { emit } = mockEmit();

      createStepSession('testco', res, emit);
      await startStepSession('testco');

      expect(mockedResolveBoardToken).toHaveBeenCalledWith(stubCompanyConfig, 'testco');
      expect(mockedExecuteStage1).toHaveBeenCalledWith('resolved-token', expect.any(Function));
    });

    test('4. Emits stage-ready(1) after Stage 1 completes', async () => {
      const mockedLoadCompanyConfig = jest.mocked(loadCompanyConfig);
      const mockedLoadSkillsProfile = jest.mocked(loadSkillsProfile);
      const mockedResolveBoardToken = jest.mocked(resolveBoardToken);
      const mockedExecuteStage1 = jest.mocked(executeStage1);

      mockedLoadCompanyConfig.mockReturnValue(stubCompanyConfig);
      mockedLoadSkillsProfile.mockReturnValue(stubSkillsProfile);
      mockedResolveBoardToken.mockReturnValue('resolved-token');

      mockedExecuteStage1.mockResolvedValue({
        jobs: [stubRawJob],
        rawCount: 1,
        report: stubStageReport(1, 1, 0),
      });

      const res = mockRes() as Response;
      const { emit, events } = mockEmit();

      createStepSession('testco', res, emit);
      await startStepSession('testco');

      // The stage-ready event should be emitted
      const stageReady = events.find((e) => e.type === 'stage-ready');
      expect(stageReady).toBeDefined();
      expect(stageReady).toMatchObject({ type: 'stage-ready', stage: 1, nextStage: 2 });
    });

    test('5. Handles Stage 1 error', async () => {
      const mockedLoadCompanyConfig = jest.mocked(loadCompanyConfig);
      const mockedLoadSkillsProfile = jest.mocked(loadSkillsProfile);
      const mockedResolveBoardToken = jest.mocked(resolveBoardToken);
      const mockedExecuteStage1 = jest.mocked(executeStage1);

      mockedLoadCompanyConfig.mockReturnValue(stubCompanyConfig);
      mockedLoadSkillsProfile.mockReturnValue(stubSkillsProfile);
      mockedResolveBoardToken.mockReturnValue('resolved-token');

      mockedExecuteStage1.mockRejectedValue(new Error('Fetch failed'));

      const res = mockRes() as Response;
      const { emit, events } = mockEmit();

      createStepSession('testco', res, emit);
      await startStepSession('testco');

      const runError = events.find((e) => e.type === 'run-error');
      expect(runError).toBeDefined();
      expect(runError).toMatchObject({ type: 'run-error', stage: 1, error: 'Fetch failed' });
      // Session should be cleaned up after error
      expect(getStepSession('testco')).toBeUndefined();
    });

    test('6. Is a no-op when no session exists', async () => {
      const mockedExecuteStage1 = jest.mocked(executeStage1);

      // Call startStepSession without createStepSession first
      await startStepSession('nonexistent');

      // Should not have called any stage function
      expect(mockedExecuteStage1).not.toHaveBeenCalled();
      // Should not throw
    });
  });

  // =========================================================================
  // advanceStepSession — Stage 2
  // =========================================================================

  describe('advanceStepSession — Stage 2', () => {
    async function setupStage1(): Promise<{
      res: Response;
      events: PipelineEvent[];
      emit: EmitCallback;
    }> {
      const mockedLoadCompanyConfig = jest.mocked(loadCompanyConfig);
      const mockedLoadSkillsProfile = jest.mocked(loadSkillsProfile);
      const mockedResolveBoardToken = jest.mocked(resolveBoardToken);
      const mockedExecuteStage1 = jest.mocked(executeStage1);

      mockedLoadCompanyConfig.mockReturnValue(stubCompanyConfig);
      mockedLoadSkillsProfile.mockReturnValue(stubSkillsProfile);
      mockedResolveBoardToken.mockReturnValue('resolved-token');

      mockedExecuteStage1.mockResolvedValue({
        jobs: [stubRawJob],
        rawCount: 1,
        report: stubStageReport(1, 1, 0),
      });

      const res = mockRes() as Response;
      const { emit, events } = mockEmit();

      createStepSession('testco', res, emit);
      await startStepSession('testco');

      return { res, events, emit };
    }

    test('7. Advances from stage 1 to stage 2', async () => {
      const mockedExecuteStage2 = jest.mocked(executeStage2);
      mockedExecuteStage2.mockReturnValue({
        result: { passed: [stubFilteredJob], rejected: [] },
        report: stubStageReport(2, 1, 0),
      });

      const { events } = await setupStage1();

      // Clear events from Stage 1 setup
      events.length = 0;

      await advanceStepSession('testco');

      expect(mockedExecuteStage2).toHaveBeenCalledWith(
        [stubRawJob],
        expect.objectContaining({
          location: 'Remote',
          departments: ['Engineering', 'Design'],
          keyword: 'Engineer',
        } as FilterConfig),
        expect.any(Function),
      );
    });

    test('8. Emits stage-ready(2) after Stage 2', async () => {
      const mockedExecuteStage2 = jest.mocked(executeStage2);
      mockedExecuteStage2.mockReturnValue({
        result: { passed: [stubFilteredJob], rejected: [] },
        report: stubStageReport(2, 1, 0),
      });

      const { events } = await setupStage1();
      events.length = 0;

      await advanceStepSession('testco');

      const stageReady = events.find((e) => e.type === 'stage-ready');
      expect(stageReady).toBeDefined();
      expect(stageReady).toMatchObject({ type: 'stage-ready', stage: 2, nextStage: 3 });
    });

    test('9. Accumulates rejected jobs from Stage 2', async () => {
      const mockedExecuteStage2 = jest.mocked(executeStage2);
      mockedExecuteStage2.mockReturnValue({
        result: { passed: [], rejected: [stubRejectedJob] },
        report: stubStageReport(2, 0, 1),
      });

      await setupStage1();
      await advanceStepSession('testco');

      const session = getStepSession('testco');
      expect(session).toBeDefined();
      // Access allRejectedJobs via the session
      expect(session!.stage2Result?.rejected).toContainEqual(stubRejectedJob);
    });

    test('10. Handles Stage 2 error', async () => {
      const mockedExecuteStage2 = jest.mocked(executeStage2);
      mockedExecuteStage2.mockImplementation(() => {
        throw new Error('Filter failed');
      });

      const { events } = await setupStage1();
      events.length = 0;

      await advanceStepSession('testco');

      const runError = events.find((e) => e.type === 'run-error');
      expect(runError).toBeDefined();
      expect(runError).toMatchObject({ type: 'run-error', stage: 2, error: 'Filter failed' });
      expect(getStepSession('testco')).toBeUndefined();
    });
  });

  // =========================================================================
  // advanceStepSession — Stages 3–5 + finalisation
  // =========================================================================

  describe('advanceStepSession — Stages 3–5', () => {
    async function setupThroughStage2(): Promise<{
      res: Response;
      events: PipelineEvent[];
      emit: EmitCallback;
    }> {
      const mockedLoadCompanyConfig = jest.mocked(loadCompanyConfig);
      const mockedLoadSkillsProfile = jest.mocked(loadSkillsProfile);
      const mockedResolveBoardToken = jest.mocked(resolveBoardToken);
      const mockedExecuteStage1 = jest.mocked(executeStage1);
      const mockedExecuteStage2 = jest.mocked(executeStage2);

      mockedLoadCompanyConfig.mockReturnValue(stubCompanyConfig);
      mockedLoadSkillsProfile.mockReturnValue(stubSkillsProfile);
      mockedResolveBoardToken.mockReturnValue('resolved-token');

      mockedExecuteStage1.mockResolvedValue({
        jobs: [stubRawJob],
        rawCount: 1,
        report: stubStageReport(1, 1, 0),
      });

      mockedExecuteStage2.mockReturnValue({
        result: { passed: [stubFilteredJob], rejected: [] },
        report: stubStageReport(2, 1, 0),
      });

      const res = mockRes() as Response;
      const { emit, events } = mockEmit();

      createStepSession('testco', res, emit);
      await startStepSession('testco');
      await advanceStepSession('testco'); // Stage 2

      return { res, events, emit };
    }

    test('11. Advances to Stage 3', async () => {
      const mockedExecuteStage3 = jest.mocked(executeStage3);
      mockedExecuteStage3.mockResolvedValue({
        result: {
          passed: [stubExtractedJob],
          rejected: [],
          stats: { heuristicHits: 1, llmFallbacks: 0, llmTokensUsed: 0, estimatedCostUsd: 0 },
        },
        report: stubStageReport(3, 1, 0),
      });

      const { events } = await setupThroughStage2();
      events.length = 0;

      await advanceStepSession('testco');

      expect(mockedExecuteStage3).toHaveBeenCalledWith(
        [stubFilteredJob],
        stubCompanyConfig,
        'TestCo',
        expect.any(Function),
      );
    });

    test('12. Emits stage-ready(3) after Stage 3', async () => {
      const mockedExecuteStage3 = jest.mocked(executeStage3);
      mockedExecuteStage3.mockResolvedValue({
        result: {
          passed: [stubExtractedJob],
          rejected: [],
          stats: { heuristicHits: 1, llmFallbacks: 0, llmTokensUsed: 0, estimatedCostUsd: 0 },
        },
        report: stubStageReport(3, 1, 0),
      });

      const { events } = await setupThroughStage2();
      events.length = 0;

      await advanceStepSession('testco');

      const stageReady = events.find((e) => e.type === 'stage-ready');
      expect(stageReady).toBeDefined();
      expect(stageReady).toMatchObject({ type: 'stage-ready', stage: 3, nextStage: 4 });
    });

    test('13. Advances to Stage 4', async () => {
      const mockedExecuteStage3 = jest.mocked(executeStage3);
      const mockedExecuteStage4 = jest.mocked(executeStage4);

      mockedExecuteStage3.mockResolvedValue({
        result: {
          passed: [stubExtractedJob],
          rejected: [],
          stats: { heuristicHits: 1, llmFallbacks: 0, llmTokensUsed: 0, estimatedCostUsd: 0 },
        },
        report: stubStageReport(3, 1, 0),
      });

      mockedExecuteStage4.mockReturnValue({
        result: { passed: [stubGatedJob], rejected: [] },
        report: stubStageReport(4, 1, 0),
      });

      await setupThroughStage2();
      await advanceStepSession('testco'); // Stage 3

      // Now advance to Stage 4
      await advanceStepSession('testco');

      expect(mockedExecuteStage4).toHaveBeenCalledWith(
        [stubExtractedJob],
        stubSkillsProfile,
        expect.any(Function),
      );
    });

    test('14. Emits stage-ready(4) after Stage 4', async () => {
      const mockedExecuteStage3 = jest.mocked(executeStage3);
      const mockedExecuteStage4 = jest.mocked(executeStage4);

      mockedExecuteStage3.mockResolvedValue({
        result: {
          passed: [stubExtractedJob],
          rejected: [],
          stats: { heuristicHits: 1, llmFallbacks: 0, llmTokensUsed: 0, estimatedCostUsd: 0 },
        },
        report: stubStageReport(3, 1, 0),
      });

      mockedExecuteStage4.mockReturnValue({
        result: { passed: [stubGatedJob], rejected: [] },
        report: stubStageReport(4, 1, 0),
      });

      const { events } = await setupThroughStage2();
      await advanceStepSession('testco'); // Stage 3
      events.length = 0;

      await advanceStepSession('testco'); // Stage 4

      const stageReady = events.find((e) => e.type === 'stage-ready');
      expect(stageReady).toBeDefined();
      expect(stageReady).toMatchObject({ type: 'stage-ready', stage: 4, nextStage: 5 });
    });

    test('15. Advances to Stage 5', async () => {
      const mockedExecuteStage3 = jest.mocked(executeStage3);
      const mockedExecuteStage4 = jest.mocked(executeStage4);
      const mockedExecuteStage5 = jest.mocked(executeStage5);

      mockedExecuteStage3.mockResolvedValue({
        result: {
          passed: [stubExtractedJob],
          rejected: [],
          stats: { heuristicHits: 1, llmFallbacks: 0, llmTokensUsed: 0, estimatedCostUsd: 0 },
        },
        report: stubStageReport(3, 1, 0),
      });

      mockedExecuteStage4.mockReturnValue({
        result: { passed: [stubGatedJob], rejected: [] },
        report: stubStageReport(4, 1, 0),
      });

      mockedExecuteStage5.mockResolvedValue({
        result: {
          scoredJobs: [stubScoredJob],
          rejected: [],
          stats: { totalJobsScored: 1, totalJobsRejected: 0, totalLlmCalls: 1, llmTokensUsed: 100, estimatedCostUsd: 0.01 },
        },
        report: stubStageReport(5, 1, 0),
      });

      await setupThroughStage2();
      await advanceStepSession('testco'); // Stage 3
      await advanceStepSession('testco'); // Stage 4

      await advanceStepSession('testco'); // Stage 5

      expect(mockedExecuteStage5).toHaveBeenCalledWith(
        [stubGatedJob],
        stubSkillsProfile,
        expect.any(Function),
      );
    });

    test('16. Finalises after Stage 5 — emits run-complete, calls persistRun, calls markProcessed, calls res.end(), removes session', async () => {
      const mockedExecuteStage3 = jest.mocked(executeStage3);
      const mockedExecuteStage4 = jest.mocked(executeStage4);
      const mockedExecuteStage5 = jest.mocked(executeStage5);
      const mockedMarkProcessed = jest.mocked(markProcessed);
      const mockedPersistRun = jest.mocked(persistRun);

      mockedExecuteStage3.mockResolvedValue({
        result: {
          passed: [stubExtractedJob],
          rejected: [],
          stats: { heuristicHits: 1, llmFallbacks: 0, llmTokensUsed: 0, estimatedCostUsd: 0 },
        },
        report: stubStageReport(3, 1, 0),
      });

      mockedExecuteStage4.mockReturnValue({
        result: { passed: [stubGatedJob], rejected: [] },
        report: stubStageReport(4, 1, 0),
      });

      mockedExecuteStage5.mockResolvedValue({
        result: {
          scoredJobs: [stubScoredJob],
          rejected: [],
          stats: { totalJobsScored: 1, totalJobsRejected: 0, totalLlmCalls: 1, llmTokensUsed: 100, estimatedCostUsd: 0.01 },
        },
        report: stubStageReport(5, 1, 0),
      });

      const { res, events } = await setupThroughStage2();
      await advanceStepSession('testco'); // Stage 3
      await advanceStepSession('testco'); // Stage 4
      events.length = 0;

      await advanceStepSession('testco'); // Stage 5 → finalise

      // Emits run-complete
      const runComplete = events.find((e) => e.type === 'run-complete');
      expect(runComplete).toBeDefined();
      expect(runComplete).toMatchObject({
        type: 'run-complete',
        reportCard: expect.objectContaining({
          totalPassed: expect.any(Number),
          totalRejected: expect.any(Number),
          totalRuntimeMs: expect.any(Number),
          estimatedCostUsd: expect.any(Number),
        }),
        scoredJobs: expect.any(Array),
      });

      // Scored jobs include metadata fields
      if (runComplete?.type === 'run-complete') {
        expect(runComplete.scoredJobs).toHaveLength(1);
        const sj = runComplete.scoredJobs[0];
        expect(sj.department).toBe('Engineering');
        expect(sj.location).toBe('Remote');
        expect(sj.gapRatio).toBe(0.2);
        expect(sj.updatedAt).toBe('2026-01-01T00:00:00Z');
        expect(sj.firstPublished).toBe('2025-01-01T00:00:00Z');
      }

      // Calls persistRun
      expect(mockedPersistRun).toHaveBeenCalled();
      const persistedOutput = mockedPersistRun.mock.calls[0][0];
      expect(persistedOutput.companyToken).toBe('testco');
      expect(persistedOutput.status).toBe('complete');

      // Calls markProcessed for each scored job
      expect(mockedMarkProcessed).toHaveBeenCalledWith(stubScoredJob.id);

      // Calls res.end()
      expect(res.end).toHaveBeenCalled();

      // Removes session from store
      expect(getStepSession('testco')).toBeUndefined();
    });
  });

  // =========================================================================
  // Guard clauses
  // =========================================================================

  describe('guard clauses', () => {
    test('17. advanceStepSession with no active session returns early', async () => {
      const mockedExecuteStage2 = jest.mocked(executeStage2);

      await advanceStepSession('nonexistent');

      // No stage function should have been called
      expect(mockedExecuteStage2).not.toHaveBeenCalled();
      // Should not throw
    });

    test('18. advanceStepSession on finished session returns early', async () => {
      // Create a session in finished state by completing all stages
      const mockedLoadCompanyConfig = jest.mocked(loadCompanyConfig);
      const mockedLoadSkillsProfile = jest.mocked(loadSkillsProfile);
      const mockedResolveBoardToken = jest.mocked(resolveBoardToken);
      const mockedExecuteStage1 = jest.mocked(executeStage1);
      const mockedExecuteStage2 = jest.mocked(executeStage2);
      const mockedExecuteStage3 = jest.mocked(executeStage3);
      const mockedExecuteStage4 = jest.mocked(executeStage4);
      const mockedExecuteStage5 = jest.mocked(executeStage5);

      mockedLoadCompanyConfig.mockReturnValue(stubCompanyConfig);
      mockedLoadSkillsProfile.mockReturnValue(stubSkillsProfile);
      mockedResolveBoardToken.mockReturnValue('resolved-token');

      mockedExecuteStage1.mockResolvedValue({
        jobs: [stubRawJob],
        rawCount: 1,
        report: stubStageReport(1, 1, 0),
      });
      mockedExecuteStage2.mockReturnValue({
        result: { passed: [stubFilteredJob], rejected: [] },
        report: stubStageReport(2, 1, 0),
      });
      mockedExecuteStage3.mockResolvedValue({
        result: {
          passed: [stubExtractedJob],
          rejected: [],
          stats: { heuristicHits: 1, llmFallbacks: 0, llmTokensUsed: 0, estimatedCostUsd: 0 },
        },
        report: stubStageReport(3, 1, 0),
      });
      mockedExecuteStage4.mockReturnValue({
        result: { passed: [stubGatedJob], rejected: [] },
        report: stubStageReport(4, 1, 0),
      });
      mockedExecuteStage5.mockResolvedValue({
        result: {
          scoredJobs: [stubScoredJob],
          rejected: [],
          stats: { totalJobsScored: 1, totalJobsRejected: 0, totalLlmCalls: 1, llmTokensUsed: 100, estimatedCostUsd: 0.01 },
        },
        report: stubStageReport(5, 1, 0),
      });

      const res = mockRes() as Response;
      const { emit } = mockEmit();

      createStepSession('testco', res, emit);
      await startStepSession('testco');
      await advanceStepSession('testco'); // Stage 2
      await advanceStepSession('testco'); // Stage 3
      await advanceStepSession('testco'); // Stage 4
      await advanceStepSession('testco'); // Stage 5 → finalise

      // Session should be removed after finalisation
      expect(getStepSession('testco')).toBeUndefined();

      // Clear call history, then try to advance again
      jest.clearAllMocks();

      await advanceStepSession('testco');

      // No stage calls should have been made
      expect(mockedExecuteStage1).not.toHaveBeenCalled();
      expect(mockedExecuteStage2).not.toHaveBeenCalled();
      expect(mockedExecuteStage3).not.toHaveBeenCalled();
      expect(mockedExecuteStage4).not.toHaveBeenCalled();
      expect(mockedExecuteStage5).not.toHaveBeenCalled();
    });

    test('19. advanceStepSession beyond stage 5 is a no-op', async () => {
      const mockedLoadCompanyConfig = jest.mocked(loadCompanyConfig);
      const mockedLoadSkillsProfile = jest.mocked(loadSkillsProfile);
      const mockedResolveBoardToken = jest.mocked(resolveBoardToken);
      const mockedExecuteStage1 = jest.mocked(executeStage1);
      const mockedExecuteStage2 = jest.mocked(executeStage2);
      const mockedExecuteStage3 = jest.mocked(executeStage3);
      const mockedExecuteStage4 = jest.mocked(executeStage4);
      const mockedExecuteStage5 = jest.mocked(executeStage5);

      mockedLoadCompanyConfig.mockReturnValue(stubCompanyConfig);
      mockedLoadSkillsProfile.mockReturnValue(stubSkillsProfile);
      mockedResolveBoardToken.mockReturnValue('resolved-token');

      mockedExecuteStage1.mockResolvedValue({
        jobs: [stubRawJob],
        rawCount: 1,
        report: stubStageReport(1, 1, 0),
      });
      mockedExecuteStage2.mockReturnValue({
        result: { passed: [stubFilteredJob], rejected: [] },
        report: stubStageReport(2, 1, 0),
      });
      mockedExecuteStage3.mockResolvedValue({
        result: {
          passed: [stubExtractedJob],
          rejected: [],
          stats: { heuristicHits: 1, llmFallbacks: 0, llmTokensUsed: 0, estimatedCostUsd: 0 },
        },
        report: stubStageReport(3, 1, 0),
      });
      mockedExecuteStage4.mockReturnValue({
        result: { passed: [stubGatedJob], rejected: [] },
        report: stubStageReport(4, 1, 0),
      });
      mockedExecuteStage5.mockResolvedValue({
        result: {
          scoredJobs: [stubScoredJob],
          rejected: [],
          stats: { totalJobsScored: 1, totalJobsRejected: 0, totalLlmCalls: 1, llmTokensUsed: 100, estimatedCostUsd: 0.01 },
        },
        report: stubStageReport(5, 1, 0),
      });

      const res = mockRes() as Response;
      const { emit } = mockEmit();

      createStepSession('testco', res, emit);
      await startStepSession('testco');
      await advanceStepSession('testco'); // Stage 2
      await advanceStepSession('testco'); // Stage 3
      await advanceStepSession('testco'); // Stage 4
      await advanceStepSession('testco'); // Stage 5 → finalise

      // At this point the session has been deleted
      jest.clearAllMocks();

      // Calling advance again should be a no-op (no session)
      await expect(advanceStepSession('testco')).resolves.toBeUndefined();

      expect(mockedExecuteStage1).not.toHaveBeenCalled();
      expect(mockedExecuteStage2).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // cancelStepSession
  // =========================================================================

  describe('cancelStepSession', () => {
    test('20. Cancels session — calls res.end(), removes from store', () => {
      const mockedLoadCompanyConfig = jest.mocked(loadCompanyConfig);
      const mockedLoadSkillsProfile = jest.mocked(loadSkillsProfile);
      mockedLoadCompanyConfig.mockReturnValue(stubCompanyConfig);
      mockedLoadSkillsProfile.mockReturnValue(stubSkillsProfile);

      const res = mockRes() as Response;
      const { emit } = mockEmit();

      createStepSession('testco', res, emit);
      expect(getStepSession('testco')).toBeDefined();

      cancelStepSession('testco');

      expect(res.end).toHaveBeenCalled();
      expect(getStepSession('testco')).toBeUndefined();
    });

    test('21. Is a no-op when no session exists', () => {
      // Should not throw
      expect(() => cancelStepSession('nonexistent')).not.toThrow();
    });
  });

  // =========================================================================
  // getStepSession
  // =========================================================================

  describe('getStepSession', () => {
    test('22. Returns undefined for unknown token', () => {
      expect(getStepSession('nonexistent')).toBeUndefined();
    });
  });
});
