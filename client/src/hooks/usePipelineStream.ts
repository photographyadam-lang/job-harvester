/**
 * usePipelineStream(token)
 *
 * Custom hook that owns all SSE (EventSource) connection logic.
 * Accumulates PipelineEvent objects into state and exposes start()
 * and reset() controls.
 *
 * Supports two run modes:
 *   - "all"  — runs all 5 stages at once (existing behaviour)
 *   - "step" — runs one stage at a time, pausing after each for manual
 *              advancement via nextStage()
 *
 * No component may connect to EventSource directly — all SSE interaction
 * must go through this hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PipelineEvent, StageNumber } from '../types/events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineStatus = 'idle' | 'running' | 'awaiting_input' | 'complete' | 'error';

export interface PipelineState {
  /** Overall run status. */
  status: PipelineStatus;
  /** All events received so far, in chronological order. */
  events: PipelineEvent[];
  /** Error message, if status is 'error'. */
  error: string | null;
  /** Per-stage summary counts (accumulated from stage-complete events). */
  stageReports: Record<StageNumber, { passed: number; rejected: number }>;
  /** In step mode: which stage will run when "Next Stage" is clicked. */
  nextStage: number | null;
}

export interface UsePipelineStreamReturn {
  state: PipelineState;
  /** Start (or restart) a full pipeline run for the given company token. */
  start: () => void;
  /** Start a step-mode session (runs Stage 1, then pauses). */
  startStep: () => void;
  /** Advance to the next stage in step mode. */
  nextStage: () => void;
  /** Cancel the step-mode session. */
  cancelStep: () => void;
  /** Close the connection and reset all state to initial values. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_STATE: PipelineState = {
  status: 'idle',
  events: [],
  error: null,
  stageReports: {} as Record<StageNumber, { passed: number; rejected: number }>,
  nextStage: null,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePipelineStream(token: string): UsePipelineStreamReturn {
  const [state, setState] = useState<PipelineState>(INITIAL_STATE);
  const esRef = useRef<EventSource | null>(null);

  // -----------------------------------------------------------------------
  // Cleanup helper
  // -----------------------------------------------------------------------
  const closeConnection = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  // -----------------------------------------------------------------------
  // Reset — close connection and reset state
  // -----------------------------------------------------------------------
  const reset = useCallback(() => {
    closeConnection();
    setState(INITIAL_STATE);
  }, [closeConnection]);

  // -----------------------------------------------------------------------
  // Shared event handler
  // -----------------------------------------------------------------------
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const parsed: PipelineEvent = JSON.parse(event.data);

      // Close EventSource synchronously for terminal events — must happen
      // BEFORE setState to prevent browser auto-reconnect from starting an
      // infinite pipeline loop.  React batches setState updaters, so a
      // close() inside the updater may execute too late.
      if (parsed.type === 'run-complete' || parsed.type === 'run-error') {
        esRef.current?.close();
        esRef.current = null;
      }

      setState((prev) => {
        // Ignore events after terminal state
        if (
          prev.status === 'complete' ||
          prev.status === 'error'
        ) {
          return prev;
        }

        const events = [...prev.events, parsed];
        const stageReports = { ...prev.stageReports };

        switch (parsed.type) {
          case 'stage-complete': {
            stageReports[parsed.stage] = {
              passed: parsed.report.passedCount,
              rejected: parsed.report.rejectedCount,
            };
            return { ...prev, events, stageReports };
          }

          case 'stage-ready': {
            // Step mode: stage finished, waiting for user to advance
            return {
              ...prev,
              status: 'awaiting_input' as PipelineStatus,
              nextStage: parsed.nextStage,
              events,
              stageReports,
            };
          }

          case 'run-complete':
            return {
              ...prev,
              status: 'complete' as PipelineStatus,
              nextStage: null,
              events,
              stageReports,
            };

          case 'run-error':
            return {
              ...prev,
              status: 'error' as PipelineStatus,
              nextStage: null,
              events,
              error: parsed.error,
              stageReports,
            };

          default:
            return { ...prev, events, stageReports };
        }
      });
    } catch {
      // Malformed JSON — skip
    }
  }, []);

  // -----------------------------------------------------------------------
  // Start — Run All mode (existing behaviour via GET /api/run/:token)
  // -----------------------------------------------------------------------
  const start = useCallback(() => {
    closeConnection();

    setState({
      status: 'running',
      events: [],
      error: null,
      stageReports: {} as Record<StageNumber, { passed: number; rejected: number }>,
      nextStage: null,
    });

    const url = `/api/run/${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = handleMessage;

    es.onerror = () => {
      // Close EventSource to prevent browser auto-reconnect from starting
      // an infinite pipeline loop.  Called synchronously before setState so
      // React batching doesn't delay the close past the reconnect window.
      esRef.current?.close();
      esRef.current = null;
      setState((prev) => {
        if (prev.status === 'complete' || prev.status === 'error') {
          return prev;
        }
        return {
          ...prev,
          status: 'error',
          error:
            'Connection to backend failed. ' +
            'Is the server running on port 3001? ' +
            'Try restarting with: npm run dev --workspace=server',
        };
      });
    };
  }, [token, closeConnection, handleMessage]);

  // -----------------------------------------------------------------------
  // startStep — Step mode (GET /api/run/:token/step/start)
  // -----------------------------------------------------------------------
  const startStep = useCallback(() => {
    closeConnection();

    setState({
      status: 'running',
      events: [],
      error: null,
      stageReports: {} as Record<StageNumber, { passed: number; rejected: number }>,
      nextStage: null,
    });

    const url = `/api/run/${encodeURIComponent(token)}/step/start`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = handleMessage;

    es.onerror = () => {
      setState((prev) => {
        if (
          prev.status === 'complete' ||
          prev.status === 'error' ||
          prev.status === 'awaiting_input'
        ) {
          // awaiting_input means the SSE is still open but a network blip
          // occurred — don't override to error
          return prev;
        }
        // Close EventSource to prevent browser auto-reconnect from
        // restarting a pipeline run the user didn't request.
        esRef.current?.close();
        esRef.current = null;
        return {
          ...prev,
          status: 'error',
          error:
            'Connection to backend failed. ' +
            'Is the server running on port 3001? ' +
            'Try restarting with: npm run dev --workspace=server',
        };
      });
    };
  }, [token, closeConnection, handleMessage]);

  // -----------------------------------------------------------------------
  // nextStage — POST /api/run/:token/step/next (fire-and-forget)
  // -----------------------------------------------------------------------
  const nextStage = useCallback(() => {
    // Mark as running again while we wait for the next stage's events
    setState((prev) => ({
      ...prev,
      status: 'running',
      nextStage: null,
    }));

    const url = `/api/run/${encodeURIComponent(token)}/step/next`;

    fetch(url, { method: 'POST' }).catch(() => {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: 'Failed to advance to next stage.',
      }));
    });
  }, [token]);

  // -----------------------------------------------------------------------
  // cancelStep — POST /api/run/:token/step/cancel then reset
  // -----------------------------------------------------------------------
  const cancelStep = useCallback(() => {
    const url = `/api/run/${encodeURIComponent(token)}/step/cancel`;

    fetch(url, { method: 'POST' })
      .catch(() => {
        // Best-effort — the session may already be gone
      })
      .finally(() => {
        reset();
      });
  }, [token, reset]);

  // -----------------------------------------------------------------------
  // Cleanup on unmount
  // -----------------------------------------------------------------------
  useEffect(() => {
    return () => {
      closeConnection();
    };
  }, [closeConnection]);

  return { state, start, startStep, nextStage, cancelStep, reset };
}
