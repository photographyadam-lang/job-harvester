/**
 * Structured server-side logger.
 *
 * Writes timestamped, stage-labelled log entries to stdout for debugging
 * pipeline runs from the terminal.  No external dependencies.
 *
 * Usage:
 *   import { createLogger } from '../utils/logger';
 *   const logger = createLogger();
 *   logger.stageStart(1, 'Fetch jobs', { token: 'figma' });
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Logger {
  /** Log a stage start with optional detail (e.g. input count). */
  stageStart(stage: number, label: string, detail?: Record<string, unknown>): void;

  /** Log a stage completion with pass / reject counts and optional detail. */
  stageComplete(
    stage: number,
    passed: number,
    rejected: number,
    detail?: Record<string, unknown>,
  ): void;

  /** Log a per-job event. */
  jobEvent(
    stage: number,
    eventType: 'passed' | 'rejected',
    jobId: number,
    detail?: Record<string, unknown>,
  ): void;

  /** Log an error. */
  error(stage: number, err: Error, context?: Record<string, unknown>): void;

  /** Log a general info message. */
  info(message: string, detail?: Record<string, unknown>): void;

  /** Log a warning. */
  warn(message: string, detail?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function isoNow(): string {
  return new Date().toISOString();
}

function formatDetail(detail?: Record<string, unknown>): string {
  if (!detail || Object.keys(detail).length === 0) return '';
  const parts = Object.entries(detail).map(
    ([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`,
  );
  return `| ${parts.join(' ')}`;
}

function createLogger(): Logger {
  return {
    stageStart(stage, label, detail): void {
      const ts = isoNow();
      const extra = formatDetail(detail);
      console.log(`[${ts}] [STAGE ${stage}] START  | ${label} ${extra}`.trimEnd());
    },

    stageComplete(stage, passed, rejected, detail): void {
      const ts = isoNow();
      const counts = `passed=${passed} rejected=${rejected}`;
      const extra = formatDetail(detail);
      console.log(`[${ts}] [STAGE ${stage}] END    | ${counts} ${extra}`.trimEnd());
    },

    jobEvent(stage, eventType, jobId, detail): void {
      const ts = isoNow();
      const extra = formatDetail(detail);
      console.log(
        `[${ts}] [STAGE ${stage}] JOB    | ${eventType} #${jobId} ${extra}`.trimEnd(),
      );
    },

    error(stage, err, context): void {
      const ts = isoNow();
      const name = err.constructor.name !== 'Error' ? `${err.constructor.name}: ` : '';
      const extra = formatDetail(context);
      console.error(
        `[${ts}] [STAGE ${stage}] ERROR  | ${name}${err.message} ${extra}`.trimEnd(),
      );
    },

    info(message, detail): void {
      const ts = isoNow();
      const extra = formatDetail(detail);
      console.log(`[${ts}] [INFO]   ${message} ${extra}`.trimEnd());
    },

    warn(message, detail): void {
      const ts = isoNow();
      const extra = formatDetail(detail);
      console.warn(`[${ts}] [WARN]   ${message} ${extra}`.trimEnd());
    },
  };
}

export { createLogger };
