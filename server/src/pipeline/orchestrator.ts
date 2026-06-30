/**
 * Pipeline Orchestrator
 *
 * Calls all five pipeline stages in sequence, emits PipelineEvent objects at
 * each stage boundary and per job, runs the dedup cache check between Stage 2
 * and Stage 3, persists the run on completion, and marks all scored jobs as
 * processed.
 *
 * Exported per-stage runner functions allow the step orchestrator to call
 * individual stages.  `runPipeline` remains the "Run All" entry point.
 *
 * This module contains no business logic — it calls stage functions and relays
 * their output as events via the `emit` callback.
 */

import { fetchJobs } from './stage1-fetch';
import { filterJobs, ConfigMismatchError } from './stage2-filter';
import { extractJobs } from './stage3-extractor';
import { filterByGap } from './stage4-gap-filter';
import { scoreJobs } from './stage5-scorer';
import { isProcessed, markProcessed } from '../output/dedupCache';
import { persistRun } from '../output/runPersister';
import { loadCompanyConfig, resolveBoardToken } from '../config/companyConfig';
import { loadSkillsProfile } from '../config/skillsProfile';
import { createLogger } from '../utils/logger';
import type { Logger } from '../utils/logger';
import type { CompanyConfig, SkillsProfile } from '../config/types';
import type {
  RawJob,
  ExtractedJob,
  GatedJob,
  PipelineRunOutput,
  ReportCard,
  StageReport,
  EmitCallback,
  FilterConfig,
  FilteredJob as FilteredJobType,
  RejectedJob,
  Stage3Result,
  Stage5Result,
  StageResult,
} from '../types';

// ---------------------------------------------------------------------------
// Logger (module-level — one instance shared by runPipeline and step runners)
// ---------------------------------------------------------------------------

const logger: Logger = createLogger();

// ---------------------------------------------------------------------------
// Exported per-stage runner functions
// ---------------------------------------------------------------------------

/**
 * Run Stage 1 — Fetch jobs from Greenhouse.
 *
 * Emits `stage-start(1)`, `job-passed(1)` for each job, and `stage-complete(1)`.
 *
 * @returns The fetch result and a stage report.
 * @throws {FetchError} On Greenhouse API errors.
 */
export async function executeStage1(
  token: string,
  emit: EmitCallback,
): Promise<{ jobs: RawJob[]; rawCount: number; report: StageReport }> {
  logger.stageStart(1, 'Fetch jobs', { token });

  emit({ type: 'stage-start', stage: 1, label: 'Fetch jobs' });

  const { jobs, rawCount } = await fetchJobs(token);

  for (const job of jobs) {
    emit({
      type: 'job-passed',
      stage: 1,
      job: {
        id: job.id,
        title: job.title,
        url: job.absolute_url,
        department: job.department.name,
        location: job.location.name,
        updatedAt: job.updated_at,
        firstPublished: job.first_published,
      },
    });
    logger.jobEvent(1, 'passed', job.id, { title: job.title });
  }

  const report: StageReport = {
    stage: 1,
    passedCount: rawCount,
    rejectedCount: 0,
  };

  emit({ type: 'stage-complete', stage: 1, report });
  logger.stageComplete(1, report.passedCount, report.rejectedCount);

  return { jobs, rawCount, report };
}

/**
 * Run Stage 2 — Metadata filter.
 *
 * Emits `stage-start(2)`, `job-passed(2)` / `job-rejected(2)`, and `stage-complete(2)`.
 *
 * @returns The filter result and a stage report.
 * @throws {ConfigMismatchError} When zero jobs survive all filters.
 */
export function executeStage2(
  jobs: RawJob[],
  config: FilterConfig,
  emit: EmitCallback,
): { result: StageResult<FilteredJobType>; report: StageReport } {
  logger.stageStart(2, 'Metadata filter', {
    input: jobs.length,
    location: config.location || '(any)',
    departments: config.departments,
    keyword: config.keyword || '(any)',
  });

  emit({ type: 'stage-start', stage: 2, label: 'Metadata filter' });

  const result = filterJobs(jobs, config);

  for (const job of result.passed) {
    emit({
      type: 'job-passed',
      stage: 2,
      job: { id: job.id, title: job.title, url: job.url },
    });
    logger.jobEvent(2, 'passed', job.id, { title: job.title });
  }

  for (const job of result.rejected) {
    emit({ type: 'job-rejected', stage: 2, job });
    logger.jobEvent(2, 'rejected', job.id, { reason: job.reason });
  }

  const report: StageReport = {
    stage: 2,
    passedCount: result.passed.length,
    rejectedCount: result.rejected.length,
  };

  emit({ type: 'stage-complete', stage: 2, report });
  logger.stageComplete(2, report.passedCount, report.rejectedCount);

  return { result, report };
}

/**
 * Run dedup cache check between Stage 2 and Stage 3.
 *
 * Jobs already in `output/processed_ids.json` are rejected with
 * `reason: "Already processed"` and `rejectedAtStage: 3`.
 *
 * @returns The deduplicated list of filtered jobs.
 */
/**
 * @deprecated Dedup check removed from pipeline flow — jobs now pass directly
 * from Stage 2 to Stage 3 on every run.  This function is kept exported for
 * potential future use but is no longer called by `runPipeline` or the step
 * orchestrator.
 */
export function executeDedupCheck(
  jobs: FilteredJobType[],
  emit: EmitCallback,
): FilteredJobType[] {
  logger.info('Dedup check', { input: jobs.length });

  const dedupFiltered: FilteredJobType[] = [];

  for (const job of jobs) {
    if (isProcessed(job.id)) {
      const rejectedJob: RejectedJob = {
        id: job.id,
        title: job.title,
        url: job.url,
        rejectedAtStage: 3,
        reason: 'Already processed',
      };
      emit({ type: 'job-rejected', stage: 3, job: rejectedJob });
      logger.jobEvent(3, 'rejected', job.id, { reason: 'Already processed' });
    } else {
      dedupFiltered.push(job);
    }
  }

  const skipped = jobs.length - dedupFiltered.length;
  if (skipped > 0) {
    logger.info('Dedup skipped', { skipped, remaining: dedupFiltered.length });
  }

  return dedupFiltered;
}

/**
 * Run Stage 3 — Extract requirements.
 *
 * Emits `stage-start(3)`, `job-passed(3)` / `job-rejected(3)`, and `stage-complete(3)`.
 *
 * @returns The extraction result and a stage report.
 */
export async function executeStage3(
  jobs: FilteredJobType[],
  config: CompanyConfig,
  companyName: string,
  emit: EmitCallback,
): Promise<{ result: Stage3Result; report: StageReport }> {
  logger.stageStart(3, 'Extract requirements', { input: jobs.length });

  emit({ type: 'stage-start', stage: 3, label: 'Extract requirements' });

  const result = await extractJobs(jobs, config, companyName);

  for (const job of result.passed) {
    emit({
      type: 'job-passed',
      stage: 3,
      job: { id: job.id, title: job.title, url: job.url },
    });
    logger.jobEvent(3, 'passed', job.id, { title: job.title });
  }

  for (const job of result.rejected) {
    emit({ type: 'job-rejected', stage: 3, job });
    logger.jobEvent(3, 'rejected', job.id, { reason: job.reason });
  }

  const report: StageReport = {
    stage: 3,
    passedCount: result.passed.length,
    rejectedCount: result.rejected.length,
  };

  emit({ type: 'stage-complete', stage: 3, report });
  logger.stageComplete(3, report.passedCount, report.rejectedCount, {
    heuristicHits: result.stats?.heuristicHits ?? 0,
    llmFallbacks: result.stats?.llmFallbacks ?? 0,
    tokens: result.stats?.llmTokensUsed ?? 0,
    costUsd: result.stats?.estimatedCostUsd ?? 0,
  });

  return { result, report };
}

/**
 * Run Stage 4 — Gap filter.
 *
 * Emits `stage-start(4)`, `job-passed(4)` / `job-rejected(4)`, and `stage-complete(4)`.
 *
 * @returns The gap-filter result and a stage report.
 */
export function executeStage4(
  jobs: ExtractedJob[],
  profile: SkillsProfile,
  emit: EmitCallback,
): { result: StageResult<GatedJob>; report: StageReport } {
  logger.stageStart(4, 'Gap filter', {
    input: jobs.length,
    gapThreshold: profile.gapThreshold,
  });

  emit({ type: 'stage-start', stage: 4, label: 'Gap filter' });

  const result = filterByGap(jobs, profile);

  for (const job of result.passed) {
    emit({
      type: 'job-passed',
      stage: 4,
      job: { id: job.id, title: job.title, url: job.url },
    });
    logger.jobEvent(4, 'passed', job.id, {
      title: job.title,
      gapRatio: Number(job.gapRatio.toFixed(2)),
    });
  }

  for (const job of result.rejected) {
    emit({ type: 'job-rejected', stage: 4, job });
    logger.jobEvent(4, 'rejected', job.id, { reason: job.reason });
  }

  const report: StageReport = {
    stage: 4,
    passedCount: result.passed.length,
    rejectedCount: result.rejected.length,
  };

  emit({ type: 'stage-complete', stage: 4, report });
  logger.stageComplete(4, report.passedCount, report.rejectedCount);

  return { result, report };
}

/**
 * Run Stage 5 — Score jobs.
 *
 * Emits `stage-start(5)`, `job-passed(5)` / `job-rejected(5)`, and `stage-complete(5)`.
 *
 * @returns The scoring result and a stage report.
 */
export async function executeStage5(
  jobs: GatedJob[],
  profile: SkillsProfile,
  emit: EmitCallback,
): Promise<{ result: Stage5Result; report: StageReport }> {
  logger.stageStart(5, 'Score jobs', { input: jobs.length });

  emit({ type: 'stage-start', stage: 5, label: 'Score jobs' });

  const result = await scoreJobs(jobs, profile);

  for (const job of result.scoredJobs) {
    emit({
      type: 'job-passed',
      stage: 5,
      job: { id: job.id, title: job.title, url: job.url },
    });
    logger.jobEvent(5, 'passed', job.id, {
      title: job.title,
      score: job.score,
    });
  }

  for (const job of result.rejected) {
    emit({ type: 'job-rejected', stage: 5, job });
    logger.jobEvent(5, 'rejected', job.id, { reason: job.reason });
  }

  const report: StageReport = {
    stage: 5,
    passedCount: result.scoredJobs.length,
    rejectedCount: result.rejected.length,
  };

  emit({ type: 'stage-complete', stage: 5, report });
  logger.stageComplete(5, report.passedCount, report.rejectedCount, {
    tokens: result.stats?.llmTokensUsed ?? 0,
    costUsd: result.stats?.estimatedCostUsd ?? 0,
  });

  return { result, report };
}

// ---------------------------------------------------------------------------
// Public API — runPipeline (Run All mode)
// ---------------------------------------------------------------------------

/**
 * Run the full job-matching pipeline for a given company token.
 *
 * Stages are called in order 1→2→3→4→5. Dedup is checked between Stage 2 and
 * Stage 3. On successful completion the run is persisted and the report card
 * is emitted.
 *
 * @param companyToken - Greenhouse company board token (e.g. `"figma"`).
 * @param emit         - Callback invoked for each PipelineEvent.
 * @returns The complete pipeline run output.
 * @throws {ConfigMismatchError} When zero jobs survive Stage 2 filters.
 * @throws {FetchError}          When the Greenhouse API returns an error.
 */
export async function runPipeline(
  companyToken: string,
  emit: EmitCallback,
): Promise<PipelineRunOutput> {
  // -------------------------------------------------------------------------
  // 1. Load configs
  // -------------------------------------------------------------------------
  logger.info('Loading configs', { token: companyToken });

  const companyConfig = loadCompanyConfig(companyToken);
  const skillsProfile = loadSkillsProfile();

  // Resolve the effective Greenhouse board token (config field or fallback to key)
  const boardToken = resolveBoardToken(companyConfig, companyToken);

  // -------------------------------------------------------------------------
  // 2. Build FilterConfig
  // -------------------------------------------------------------------------
  const filterConfig: FilterConfig = {
    location: companyConfig.location,
    departments: companyConfig.departments,
    keyword: companyConfig.keyword,
  };

  // -------------------------------------------------------------------------
  // 3. Initialise accumulators
  // -------------------------------------------------------------------------
  const stageReports: StageReport[] = [];
  const allRejectedJobs: RejectedJob[] = [];
  const startTime = Date.now();

  // -------------------------------------------------------------------------
  // 4. Stage 1 — Fetch
  // -------------------------------------------------------------------------
  const s1 = await executeStage1(boardToken, emit);
  const { jobs: rawJobs } = s1;
  stageReports.push(s1.report);

  // -------------------------------------------------------------------------
  // 5. Stage 2 — Metadata Filter
  // -------------------------------------------------------------------------
  let stage2Passed: FilteredJobType[];
  try {
    const s2 = executeStage2(rawJobs, filterConfig, emit);
    stage2Passed = s2.result.passed;
    stageReports.push(s2.report);
    allRejectedJobs.push(...s2.result.rejected);
  } catch (err) {
    if (err instanceof ConfigMismatchError) {
      emit({ type: 'run-error', stage: 2, error: err.message });
      logger.error(2, err);
    }
    throw err;
  }

  // -------------------------------------------------------------------------
  // 6. Stage 3 — Extract
  // -------------------------------------------------------------------------
  const s3 = await executeStage3(
    stage2Passed,
    companyConfig,
    companyConfig.name,
    emit,
  );
  stageReports.push(s3.report);
  allRejectedJobs.push(...s3.result.rejected);

  // -------------------------------------------------------------------------
  // 7. Stage 4 — Gap Filter
  // -------------------------------------------------------------------------
  const s4 = executeStage4(s3.result.passed, skillsProfile, emit);
  stageReports.push(s4.report);
  allRejectedJobs.push(...s4.result.rejected);

  // -------------------------------------------------------------------------
  // 8. Stage 5 — Score
  // -------------------------------------------------------------------------
  const s5 = await executeStage5(s4.result.passed, skillsProfile, emit);
  stageReports.push(s5.report);
  allRejectedJobs.push(...s5.result.rejected);

  // -------------------------------------------------------------------------
  // 9. Compute ReportCard
  // -------------------------------------------------------------------------
  const totalRuntimeMs = Date.now() - startTime;

  const totalPassed = stageReports.reduce(
    (sum, sr) => sum + sr.passedCount,
    0,
  );
  const totalRejected = stageReports.reduce(
    (sum, sr) => sum + sr.rejectedCount,
    0,
  );

  const stage3Cost = s3.result.stats?.estimatedCostUsd ?? 0;
  const stage5Cost = s5.result.stats?.estimatedCostUsd ?? 0;

  const reportCard: ReportCard = {
    stages: stageReports,
    totalPassed,
    totalRejected,
    totalRuntimeMs,
    estimatedCostUsd: stage3Cost + stage5Cost,
    heuristicHits: s3.result.stats?.heuristicHits ?? 0,
    llmFallbacks: s3.result.stats?.llmFallbacks ?? 0,
  };

  // -------------------------------------------------------------------------
  // 10. Mark processed
  // -------------------------------------------------------------------------
  for (const job of s5.result.scoredJobs) {
    markProcessed(job.id);
  }
  logger.info('Marked processed', { count: s5.result.scoredJobs.length });

  // -------------------------------------------------------------------------
  // 11. Build PipelineRunOutput
  // -------------------------------------------------------------------------
  const output: PipelineRunOutput = {
    companyToken,
    runAt: new Date().toISOString(),
    status: 'complete',
    reportCard,
    scoredJobs: s5.result.scoredJobs,
    rejectedJobs: allRejectedJobs,
  };

  // -------------------------------------------------------------------------
  // 12. Persist
  // -------------------------------------------------------------------------
  persistRun(output);
  logger.info('Run persisted', { company: companyToken });

  // -------------------------------------------------------------------------
  // 13. Emit run-complete
  // -------------------------------------------------------------------------
  const scoredJobSummaries = s5.result.scoredJobs.map((job) => ({
    id: job.id,
    title: job.title,
    url: job.url,
    score: job.score,
    scoreReasoning: job.scoreReasoning,
    matchedSkills: job.matchedSkills,
    unmatchedSkills: job.unmatchedSkills,
    mustHaves: job.requirements.must_haves,
    niceToHaves: job.requirements.nice_to_haves,
  }));

  emit({ type: 'run-complete', reportCard, scoredJobs: scoredJobSummaries });

  logger.info('Run complete', {
    totalPassed,
    totalRejected,
    runtimeMs: totalRuntimeMs,
    costUsd: Number((stage3Cost + stage5Cost).toFixed(4)),
  });

  // -------------------------------------------------------------------------
  // 14. Return
  // -------------------------------------------------------------------------
  return output;
}
