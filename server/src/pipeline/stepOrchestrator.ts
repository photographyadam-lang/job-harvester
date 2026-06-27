/**
 * Step Orchestrator
 *
 * Manages stateful step-mode pipeline sessions so the user can advance through
 * stages one at a time from the UI.
 *
 * A session is created via `createStepSession` (runs Stage 1, emits events,
 * then pauses).  The client calls `advanceStepSession` to trigger each
 * subsequent stage.  `cancelStepSession` tears everything down.
 *
 * Only one session per company token is allowed at a time.
 */

import { type Response } from 'express';
import { loadCompanyConfig } from '../config/companyConfig';
import { loadSkillsProfile } from '../config/skillsProfile';
import { isProcessed, markProcessed } from '../output/dedupCache';
import { persistRun } from '../output/runPersister';
import { createLogger } from '../utils/logger';
import type { Logger } from '../utils/logger';
import {
  executeStage1,
  executeStage2,
  executeDedupCheck,
  executeStage3,
  executeStage4,
  executeStage5,
} from './orchestrator';
import type {
  RawJob,
  FilteredJob,
  ExtractedJob,
  GatedJob,
  RejectedJob,
  StageReport,
  EmitCallback,
  FilterConfig,
  ReportCard,
  PipelineRunOutput,
} from '../types';
import type { CompanyConfig, SkillsProfile } from '../config/types';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger: Logger = createLogger();

// ---------------------------------------------------------------------------
// Session type
// ---------------------------------------------------------------------------

interface StepSession {
  /** Company token (session key). */
  token: string;
  /** SSE response object for streaming events to the client. */
  res: Response;
  /** Emit callback bound to the SSE response. */
  emit: EmitCallback;
  /** Last fully-completed stage (0 = not started yet, 1-5 = completed). */
  currentStage: number;
  /** Whether a terminal event has been sent. */
  finished: boolean;

  // Configs
  companyConfig: CompanyConfig;
  skillsProfile: SkillsProfile;
  filterConfig: FilterConfig;

  // Accumulated data
  rawJobs: RawJob[];
  stage2Result?: { passed: FilteredJob[]; rejected: RejectedJob[] };
  dedupFiltered: FilteredJob[];
  stage3Result?: { passed: ExtractedJob[]; rejected: RejectedJob[] };
  stage4Result?: { passed: GatedJob[]; rejected: RejectedJob[] };
  stage5Result?: { scoredJobs: import('../types').ScoredJob[]; rejected: RejectedJob[] };

  allRejectedJobs: RejectedJob[];
  stageReports: StageReport[];
  startTime: number;

  // Stage 3 stats for report card
  heuristicHits: number;
  llmFallbacks: number;
  stage3Cost: number;
  stage5Cost: number;
}

// ---------------------------------------------------------------------------
// In-memory session store
// ---------------------------------------------------------------------------

const sessions = new Map<string, StepSession>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a step session for the given company token.
 *
 * Sets up SSE headers on `res`, loads configs, runs Stage 1, emits
 * `stage-ready(1)`, and keeps the connection open for subsequent stages.
 *
 * If a session already exists for this token it is cancelled first.
 */
export function createStepSession(
  token: string,
  res: Response,
  emit: EmitCallback,
): void {
  logger.info('Step session starting', { token });

  // Cancel any existing session for this token
  if (sessions.has(token)) {
    logger.warn('Replacing existing step session', { token });
    cancelStepSession(token);
  }

  // Load configs
  const companyConfig = loadCompanyConfig(token);
  const skillsProfile = loadSkillsProfile();

  const filterConfig: FilterConfig = {
    location: companyConfig.location,
    departments: companyConfig.departments,
    keyword: companyConfig.keyword,
  };

  // Build session skeleton
  const session: StepSession = {
    token,
    res,
    emit,
    currentStage: 0,
    finished: false,
    companyConfig,
    skillsProfile,
    filterConfig,
    rawJobs: [],
    dedupFiltered: [],
    allRejectedJobs: [],
    stageReports: [],
    startTime: Date.now(),
    heuristicHits: 0,
    llmFallbacks: 0,
    stage3Cost: 0,
    stage5Cost: 0,
  };

  sessions.set(token, session);

  // Handle client disconnect
  res.on('close', () => {
    logger.info('Step session SSE closed by client', { token });
    sessions.delete(token);
  });
}

/**
 * Run Stage 1 asynchronously after the session has been created.
 *
 * This is called by the route handler after `createStepSession` returns so
 * the SSE headers are already flushed to the client.
 */
export async function startStepSession(token: string): Promise<void> {
  const session = sessions.get(token);
  if (!session) {
    logger.warn('startStepSession called with no active session', { token });
    return;
  }

  try {
    const s1 = await executeStage1(token, session.emit);
    session.rawJobs = s1.jobs;
    session.stageReports.push(s1.report);
    session.currentStage = 1;

    // Emit stage-ready — tells client we're waiting for "next" click
    session.emit({ type: 'stage-ready', stage: 1, nextStage: 2 });
  } catch (err) {
    handleSessionError(session, 1, err);
  }
}

/**
 * Advance the session to the next stage.
 *
 * Called by the `step/next` route.  Runs the appropriate stage based on
 * `session.currentStage`, emits all events on the existing SSE stream,
 * and either emits `stage-ready` (more stages remain) or `run-complete`
 * (finished).
 */
export async function advanceStepSession(token: string): Promise<void> {
  const session = sessions.get(token);
  if (!session) {
    logger.warn('advanceStepSession called with no active session', { token });
    return;
  }

  if (session.finished) {
    logger.warn('advanceStepSession called on finished session', { token });
    return;
  }

  const nextStage = session.currentStage + 1;
  logger.info('Advancing step session', { token, nextStage });

  try {
    switch (nextStage) {
      // -----------------------------------------------------------------
      // Stage 2
      // -----------------------------------------------------------------
      case 2: {
        const s2 = executeStage2(
          session.rawJobs,
          session.filterConfig,
          session.emit,
        );
        session.stage2Result = s2.result;
        session.stageReports.push(s2.report);
        session.allRejectedJobs.push(...s2.result.rejected);
        session.currentStage = 2;

        // Dedup check
        const dedupFiltered = executeDedupCheck(
          s2.result.passed,
          session.emit,
        );
        for (const job of s2.result.passed) {
          if (isProcessed(job.id)) {
            session.allRejectedJobs.push({
              id: job.id,
              title: job.title,
              url: job.url,
              rejectedAtStage: 3,
              reason: 'Already processed',
            });
          }
        }
        session.dedupFiltered = dedupFiltered;
        session.currentStage = 2; // still stage 2 as far as the user knows; dedup is transparent

        session.emit({ type: 'stage-ready', stage: 2, nextStage: 3 });
        break;
      }

      // -----------------------------------------------------------------
      // Stage 3
      // -----------------------------------------------------------------
      case 3: {
        const s3 = await executeStage3(
          session.dedupFiltered,
          session.companyConfig,
          session.companyConfig.name,
          session.emit,
        );
        session.stage3Result = s3.result;
        session.stageReports.push(s3.report);
        session.allRejectedJobs.push(...s3.result.rejected);
        session.heuristicHits = s3.result.stats?.heuristicHits ?? 0;
        session.llmFallbacks = s3.result.stats?.llmFallbacks ?? 0;
        session.stage3Cost = s3.result.stats?.estimatedCostUsd ?? 0;
        session.currentStage = 3;

        session.emit({ type: 'stage-ready', stage: 3, nextStage: 4 });
        break;
      }

      // -----------------------------------------------------------------
      // Stage 4
      // -----------------------------------------------------------------
      case 4: {
        if (!session.stage3Result) {
          throw new Error('Stage 3 result missing — cannot run Stage 4');
        }
        const s4 = executeStage4(
          session.stage3Result.passed,
          session.skillsProfile,
          session.emit,
        );
        session.stage4Result = s4.result;
        session.stageReports.push(s4.report);
        session.allRejectedJobs.push(...s4.result.rejected);
        session.currentStage = 4;

        session.emit({ type: 'stage-ready', stage: 4, nextStage: 5 });
        break;
      }

      // -----------------------------------------------------------------
      // Stage 5
      // -----------------------------------------------------------------
      case 5: {
        if (!session.stage4Result) {
          throw new Error('Stage 4 result missing — cannot run Stage 5');
        }
        const s5 = await executeStage5(
          session.stage4Result.passed,
          session.skillsProfile,
          session.emit,
        );
        session.stage5Result = s5.result;
        session.stageReports.push(s5.report);
        session.allRejectedJobs.push(...s5.result.rejected);
        session.stage5Cost = s5.result.stats?.estimatedCostUsd ?? 0;
        session.currentStage = 5;

        // Finalise — emit run-complete, persist, mark processed, clean up
        finaliseStepSession(session);
        break;
      }

      default:
        logger.warn('Unknown next stage', { token, nextStage });
    }
  } catch (err) {
    handleSessionError(session, nextStage, err);
  }
}

/**
 * Cancel an active step session.
 *
 * Closes the SSE connection and removes the session from the store.
 */
export function cancelStepSession(token: string): void {
  const session = sessions.get(token);
  if (!session) return;

  logger.info('Step session cancelled', { token, stage: session.currentStage });

  session.finished = true;
  try {
    session.res.end();
  } catch {
    // Best-effort — connection may already be closed
  }
  sessions.delete(token);
}

/**
 * Get a read-only reference to an active step session (for route handlers).
 */
export function getStepSession(token: string): StepSession | undefined {
  return sessions.get(token);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Handle an error during step execution.
 */
function handleSessionError(
  session: StepSession,
  stage: number,
  err: unknown,
): void {
  const message = err instanceof Error ? err.message : 'Unknown error';
  logger.error(stage, err instanceof Error ? err : new Error(String(err)), {
    token: session.token,
  });

  session.emit({ type: 'run-error', stage: stage as 1 | 2 | 3 | 4 | 5, error: message });
  session.finished = true;

  try {
    session.res.end();
  } catch {
    // Best-effort
  }
  sessions.delete(session.token);
}

/**
 * Finalise a step session after Stage 5 completes successfully.
 */
function finaliseStepSession(session: StepSession): void {
  const totalRuntimeMs = Date.now() - session.startTime;

  const totalPassed = session.stageReports.reduce(
    (sum, sr) => sum + sr.passedCount,
    0,
  );
  const totalRejected = session.stageReports.reduce(
    (sum, sr) => sum + sr.rejectedCount,
    0,
  );

  const reportCard: ReportCard = {
    stages: session.stageReports,
    totalPassed,
    totalRejected,
    totalRuntimeMs,
    estimatedCostUsd: session.stage3Cost + session.stage5Cost,
    heuristicHits: session.heuristicHits,
    llmFallbacks: session.llmFallbacks,
  };

  // Mark processed
  if (session.stage5Result) {
    for (const job of session.stage5Result.scoredJobs) {
      markProcessed(job.id);
    }
    logger.info('Marked processed', {
      count: session.stage5Result.scoredJobs.length,
    });
  }

  // Build output
  const output: PipelineRunOutput = {
    companyToken: session.token,
    runAt: new Date().toISOString(),
    status: 'complete',
    reportCard,
    scoredJobs: session.stage5Result?.scoredJobs ?? [],
    rejectedJobs: session.allRejectedJobs,
  };

  // Persist
  persistRun(output);
  logger.info('Run persisted', { company: session.token });

  // Emit run-complete
  const scoredJobSummaries = (session.stage5Result?.scoredJobs ?? []).map(
    (job) => ({
      id: job.id,
      title: job.title,
      url: job.url,
      score: job.score,
      scoreReasoning: job.scoreReasoning,
      matchedSkills: job.matchedSkills,
      unmatchedSkills: job.unmatchedSkills,
      mustHaves: job.requirements.must_haves,
      niceToHaves: job.requirements.nice_to_haves,
    }),
  );

  session.emit({ type: 'run-complete', reportCard, scoredJobs: scoredJobSummaries });

  logger.info('Run complete (step mode)', {
    totalPassed,
    totalRejected,
    runtimeMs: totalRuntimeMs,
    costUsd: Number((session.stage3Cost + session.stage5Cost).toFixed(4)),
  });

  // Clean up
  session.finished = true;
  try {
    session.res.end();
  } catch {
    // Best-effort
  }
  sessions.delete(session.token);
}
