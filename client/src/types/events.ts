/**
 * Client-side mirror of the server's PipelineEvent types.
 *
 * These types are intentionally duplicated from server/src/types/index.ts
 * rather than imported from the server workspace, keeping the client
 * self-contained. They must be kept in sync manually.
 */

// ---------------------------------------------------------------------------
// Re-exported primitives
// ---------------------------------------------------------------------------

export type StageNumber = 1 | 2 | 3 | 4 | 5;

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/** Emitted when a pipeline stage begins execution. */
export interface StageStartEvent {
  type: 'stage-start';
  stage: StageNumber;
  label: string;
}

export interface StageReport {
  stage: StageNumber;
  passedCount: number;
  rejectedCount: number;
}

/** Emitted when a pipeline stage completes execution. */
export interface StageCompleteEvent {
  type: 'stage-complete';
  stage: StageNumber;
  report: StageReport;
}

/** Emitted when a job passes a stage (one event per job per stage). */
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

/** Emitted when a job is rejected at a stage. */
export interface JobRejectedEvent {
  type: 'job-rejected';
  stage: StageNumber;
  job: {
    id: number;
    title: string;
    url: string;
    rejectedAtStage: StageNumber;
    reason: string;
  };
}

/** Emitted when a non-recoverable error occurs during a pipeline run. */
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

/** Emitted when the pipeline run completes successfully. */
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

/** Run mode — "all" runs all stages at once; "step" runs one at a time. */
export type RunMode = 'all' | 'step';
