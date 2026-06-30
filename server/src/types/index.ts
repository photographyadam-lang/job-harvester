/**
 * Shared TypeScript interfaces for the Job Matching Pipeline.
 *
 * This file is the single source of truth for every stage's input and output shape.
 * All stage modules, server routes, and client code import from this file.
 * No implementation logic, utility functions, or constants belong here.
 */

// ---------------------------------------------------------------------------
// Primitive / union types
// ---------------------------------------------------------------------------

/** Skill strength levels used in skills profiles. */
export type JobStrength = 'must_have' | 'nice_to_have' | 'preferred';

/** Pipeline stage numbers (1-indexed). */
export type StageNumber = 1 | 2 | 3 | 4 | 5;

/** Overall status of a pipeline run. */
export type RunStatus = 'idle' | 'running' | 'complete' | 'error';

// ---------------------------------------------------------------------------
// Stage data types
// ---------------------------------------------------------------------------

/** A job as returned by the Greenhouse API (pre-filtering). */
export interface RawJob {
  id: number;
  title: string;
  content: string;
  location: { name: string };
  department: { name: string };
  absolute_url: string;
  /** e.g. "2026-04-16T05:25:34-04:00" — ISO 8601. */
  updated_at?: string;
  /** e.g. "2024-11-01T06:05:10-04:00" — ISO 8601. */
  first_published?: string;
}

/** A job that passed Stage 2 (metadata filter). */
export interface FilteredJob {
  id: number;
  title: string;
  content: string;
  location: string;
  department: string;
  url: string;
  /** Describes which filter criteria caused this job to pass (e.g. "Role+Dept match: ..."). */
  matchReason: string;
}

/** Must-have and nice-to-have requirements extracted from a job posting. */
export interface ExtractedRequirements {
  must_haves: string[];
  nice_to_haves: string[];
}

/** A job with extracted requirements (post Stage 3). */
export interface ExtractedJob extends FilteredJob {
  requirements: ExtractedRequirements;
}

/** A job that passed Stage 4 (gap filter). */
export interface GatedJob extends ExtractedJob {
  gapRatio: number;
  matchedSkills: string[];
  unmatchedSkills: string[];
}

/** A scored job (post Stage 5), sorted by score descending. */
export interface ScoredJob extends GatedJob {
  score: number;
  scoreReasoning: string;
}

/** A job rejected at some stage, with the reason for rejection. */
export interface RejectedJob {
  id: number;
  title: string;
  url: string;
  rejectedAtStage: StageNumber;
  reason: string;
}

// ---------------------------------------------------------------------------
// Aggregate / pipeline-level types
// ---------------------------------------------------------------------------

/** Generic result produced by each pipeline stage. */
export interface StageResult<T> {
  passed: T[];
  rejected: RejectedJob[];
}

/** Per-stage summary statistics. */
export interface StageReport {
  stage: StageNumber;
  passedCount: number;
  rejectedCount: number;
}

/** Combined summary across all five stages at the end of a pipeline run. */
export interface ReportCard {
  stages: StageReport[];
  totalPassed: number;
  totalRejected: number;
  totalRuntimeMs: number;
  estimatedCostUsd: number;
  /** Number of jobs where heuristic section-header extraction succeeded. */
  heuristicHits: number;
  /** Number of jobs that fell back to LLM extraction. */
  llmFallbacks: number;
}

/**
 * Configuration object consumed by Stage 2 (metadata filter).
 * Pre-validated by the orchestrator before being passed to `filterJobs`.
 */
export interface FilterConfig {
  /** Comma-separated location substrings (case-insensitive OR match on `RawJob.location.name`).
   *  "Remote" matches "Remote - Virginia", etc. Leave blank to skip. */
  location: string;
  /** Allowed department names (case-insensitive exact match on `RawJob.department.name`). */
  departments: string[];
  /** Comma-separated role-name keywords matched against the job title
   *  (case-insensitive substring OR match). Used in Phase 2 Branch A
   *  together with `departments`. Leave blank to skip. */
  keyword: string;
  /** Comma-separated keywords matched against `RawJob.content` (the HTML
   *  description). Case-insensitive substring OR match. This is Phase 2
   *  Branch B — a job passes if it matches here even when it fails the
   *  (keyword AND departments) check. Leave blank to skip. */
  descriptionKeyword: string;
}

/** The complete output produced by a successful pipeline run. */
export interface ExtractionStats {
  /** Number of jobs where heuristic section-header extraction succeeded. */
  heuristicHits: number;
  /** Number of jobs that fell back to LLM extraction. */
  llmFallbacks: number;
  /** Total tokens consumed across all LLM calls in this stage. */
  llmTokensUsed: number;
  /** Estimated USD cost across all LLM calls in this stage. */
  estimatedCostUsd: number;
}

/**
 * Output produced by Stage 3 (Extractor).
 * Extends the generic stage-result shape with extraction statistics.
 */
export interface Stage3Result {
  passed: ExtractedJob[];
  rejected: RejectedJob[];
  stats: ExtractionStats;
}

/**
 * Statistics tracked across Stage 5 (Scorer) LLM calls.
 */
export interface ScoringStats {
  /** Number of jobs that were successfully scored. */
  totalJobsScored: number;
  /** Number of jobs rejected during scoring (LLM errors / schema failures). */
  totalJobsRejected: number;
  /** Total DeepSeek API calls made in this stage. */
  totalLlmCalls: number;
  /** Total tokens consumed across all LLM calls in this stage. */
  llmTokensUsed: number;
  /** Estimated USD cost across all LLM calls in this stage. */
  estimatedCostUsd: number;
}

// ---------------------------------------------------------------------------
// Pipeline event types (consumed by SSE routes and React hook)
// ---------------------------------------------------------------------------

/**
 * Emitted when a pipeline stage begins execution.
 */
export interface StageStartEvent {
  type: 'stage-start';
  stage: StageNumber;
  label: string;
}

/**
 * Emitted when a pipeline stage completes execution.
 */
export interface StageCompleteEvent {
  type: 'stage-complete';
  stage: StageNumber;
  report: StageReport;
}

/**
 * Emitted when a job passes a stage (one event per job per stage).
 */
export interface JobPassedEvent {
  type: 'job-passed';
  stage: StageNumber;
  job: {
    id: number;
    title: string;
    url: string;
    /** Set by Stage 1 (Fetch) only. */
    department?: string;
    /** Set by Stage 1 (Fetch) only. */
    location?: string;
    /** ISO 8601 — set by Stage 1 (Fetch) only. */
    updatedAt?: string;
    /** ISO 8601 — set by Stage 1 (Fetch) only. */
    firstPublished?: string;
    /** Describes why the job passed (set by Stage 2 filter). */
    matchReason?: string;
  };
}

/**
 * Emitted when a job is rejected at a stage.
 */
export interface JobRejectedEvent {
  type: 'job-rejected';
  stage: StageNumber;
  job: RejectedJob;
}

/**
 * Emitted when a non-recoverable error occurs during a pipeline run.
 */
export interface RunErrorEvent {
  type: 'run-error';
  stage: StageNumber;
  error: string;
}

/**
 * Emitted in step mode when a stage completes and the orchestrator is waiting
 * for the user to click "Next Stage".
 */
export interface StageReadyEvent {
  type: 'stage-ready';
  stage: StageNumber;
  /** The stage that will run next (null if this was the final stage). */
  nextStage: StageNumber | null;
}

/** Lightweight scored-job payload sent to the client on run-complete. */
export interface ScoredJobSummary {
  id: number;
  title: string;
  url: string;
  score: number;
  scoreReasoning: string;
  matchedSkills: string[];
  unmatchedSkills: string[];
  mustHaves: string[];
  niceToHaves: string[];
  /** Department name (e.g. "Engineering") — from Stage 2 filter. */
  department: string;
  /** Location name (e.g. "San Francisco, CA") — from Stage 2 filter. */
  location: string;
  /** Gap ratio from Stage 4 (0 = all must-have skills matched, 1+ = many unmatched). */
  gapRatio: number;
  /** ISO 8601 timestamp from Greenhouse "updated_at" — set by Stage 1. */
  updatedAt?: string;
  /** ISO 8601 timestamp from Greenhouse "first_published" — set by Stage 1. */
  firstPublished?: string;
}

/**
 * Emitted when the pipeline run completes successfully.
 */
export interface RunCompleteEvent {
  type: 'run-complete';
  reportCard: ReportCard;
  scoredJobs: ScoredJobSummary[];
}

/** Discriminated union of all events emitted by runPipeline. */
export type PipelineEvent =
  | StageStartEvent
  | StageCompleteEvent
  | JobPassedEvent
  | JobRejectedEvent
  | RunErrorEvent
  | RunCompleteEvent
  | StageReadyEvent;

/** Callback signature for the orchestrator's emit parameter. */
export type EmitCallback = (event: PipelineEvent) => void;

/**
 * Output produced by Stage 5 (Scorer).
 */
export interface Stage5Result {
  /** Jobs successfully scored, sorted by score descending. */
  scoredJobs: ScoredJob[];
  /** Jobs rejected during scoring (LLM errors or schema validation failures). */
  rejected: RejectedJob[];
  /** Scoring statistics. */
  stats: ScoringStats;
}

/** The complete output produced by a successful pipeline run. */
export interface PipelineRunOutput {
  companyToken: string;
  runAt: string;
  status: RunStatus;
  reportCard: ReportCard;
  scoredJobs: ScoredJob[];
  rejectedJobs: RejectedJob[];
}

// ---------------------------------------------------------------------------
// Discovery & suggestion types
// ---------------------------------------------------------------------------

/** A named item with a frequency count (e.g. location, department, keyword). */
export interface FrequencyItem {
  name: string;
  count: number;
}

/** Response shape for GET /api/discover/:token */
export interface DiscoverResponse {
  locations: FrequencyItem[];
  departments: FrequencyItem[];
}

/** Response shape for POST /api/config/company/:token/suggest-keywords */
export interface SuggestKeywordsResponse {
  roles: FrequencyItem[];
  specializations: FrequencyItem[];
}
