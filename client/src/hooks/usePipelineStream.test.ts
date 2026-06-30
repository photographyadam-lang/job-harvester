/**
 * Tests for usePipelineStream hook.
 *
 * Covers all state transitions, EventSource lifecycle, run-all mode,
 * step mode, and edge cases including the EventSource auto-reconnect
 * regression (tests #6, #10, #16, #17).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePipelineStream } from './usePipelineStream';
import type {
  StageNumber,
  StageStartEvent,
  StageCompleteEvent,
  JobPassedEvent,
  JobRejectedEvent,
  RunErrorEvent,
  RunCompleteEvent,
  StageReadyEvent,
} from '../types/events';

// ---------------------------------------------------------------------------
// Mock EventSource
// ---------------------------------------------------------------------------

/** Collected instances so tests can inspect / drive them. */
let mockESInstances: MockEventSource[] = [];

interface MockEventSource {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
}

// We track instances via a factory, not a class, so each instance gets its
// own fresh `vi.fn()` for `.close`.
function createMockEventSource(url: string): MockEventSource {
  const es: MockEventSource = {
    url,
    onmessage: null,
    onerror: null,
    close: vi.fn(),
  };
  mockESInstances.push(es);
  return es;
}

/** Simulate an incoming SSE message on a mock EventSource. */
function emitSSE(es: MockEventSource, data: object): void {
  es.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
}

/** Simulate an SSE connection error. */
function emitError(es: MockEventSource): void {
  es.onerror?.();
}

// ---------------------------------------------------------------------------
// Helpers for constructing typed events
// ---------------------------------------------------------------------------

const stageStart = (stage: StageNumber, label: string): StageStartEvent => ({
  type: 'stage-start',
  stage,
  label,
});

const stageComplete = (
  stage: StageNumber,
  passed: number,
  rejected: number,
): StageCompleteEvent => ({
  type: 'stage-complete',
  stage,
  report: { stage, passedCount: passed, rejectedCount: rejected },
});

const jobPassed = (stage: StageNumber, id: number, title: string): JobPassedEvent => ({
  type: 'job-passed',
  stage,
  job: { id, title, url: `https://example.com/jobs/${id}` },
});

const jobRejected = (
  stage: StageNumber,
  id: number,
  title: string,
  reason: string,
): JobRejectedEvent => ({
  type: 'job-rejected',
  stage,
  job: {
    id,
    title,
    url: `https://example.com/jobs/${id}`,
    rejectedAtStage: stage,
    reason,
  },
});

const runError = (stage: StageNumber, error: string): RunErrorEvent => ({
  type: 'run-error',
  stage,
  error,
});

const runComplete = (): RunCompleteEvent => ({
  type: 'run-complete',
  reportCard: {
    stages: [],
    totalPassed: 0,
    totalRejected: 0,
    totalRuntimeMs: 1000,
    estimatedCostUsd: 0.05,
    heuristicHits: 0,
    llmFallbacks: 0,
  },
  scoredJobs: [],
});

const stageReady = (
  stage: StageNumber,
  next: StageNumber | null,
): StageReadyEvent => ({
  type: 'stage-ready',
  stage,
  nextStage: next,
});

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockESInstances = [];
  vi.stubGlobal(
    'EventSource',
    vi.fn((url: string) => createMockEventSource(url)),
  );
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helper: render the hook with a default token
// ---------------------------------------------------------------------------

const TOKEN = 'test-token';

function render(token: string = TOKEN) {
  return renderHook(() => usePipelineStream(token));
}

/** Get the most recently created MockEventSource. */
function lastES(): MockEventSource {
  const es = mockESInstances[mockESInstances.length - 1];
  if (!es) throw new Error('No EventSource instance created yet');
  return es;
}

// ===========================================================================
// Initial state
// ===========================================================================

describe('initial state', () => {
  it('1. returns idle status with empty events when no token provided (empty string)', () => {
    const { result } = renderHook(() => usePipelineStream(''));

    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.events).toEqual([]);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.stageReports).toEqual({});
    expect(result.current.state.nextStage).toBeNull();
  });

  it('returns idle status with empty events for a valid token', () => {
    const { result } = render();

    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.events).toEqual([]);
    expect(result.current.state.error).toBeNull();
  });
});

// ===========================================================================
// Run-all mode (start)
// ===========================================================================

describe('run-all mode (start)', () => {
  it('2. start() creates EventSource with correct URL', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });

    const es = lastES();
    expect(es.url).toBe('/api/run/test-token');
  });

  it('3. start() sets status to running', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });

    expect(result.current.state.status).toBe('running');
  });

  it('4. receiving stage-start events updates state', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });

    const es = lastES();

    act(() => {
      emitSSE(es, stageStart(1 as StageNumber, 'Fetch jobs'));
    });

    expect(result.current.state.events).toHaveLength(1);
    expect(result.current.state.events[0].type).toBe('stage-start');
    expect((result.current.state.events[0] as StageStartEvent).stage).toBe(1);
    expect(result.current.state.status).toBe('running');
  });

  it('5. receiving stage-complete events updates stageReports', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });

    const es = lastES();

    act(() => {
      emitSSE(es, stageComplete(1 as StageNumber, 5, 2));
    });

    expect(result.current.state.stageReports[1]).toEqual({
      passed: 5,
      rejected: 2,
    });
    expect(result.current.state.events).toHaveLength(1);
  });

  it('6. receiving run-complete event sets status to complete and closes EventSource', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });

    const es = lastES();

    act(() => {
      emitSSE(es, runComplete());
    });

    expect(result.current.state.status).toBe('complete');
    expect(result.current.state.nextStage).toBeNull();
    expect(es.close).toHaveBeenCalledOnce();
  });

  it('7. receiving run-error event sets status to error and closes EventSource', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });

    const es = lastES();

    act(() => {
      emitSSE(es, runError(3 as StageNumber, 'LLM timeout'));
    });

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toBe('LLM timeout');
    expect(es.close).toHaveBeenCalledOnce();
  });

  it('8. start() closes previous connection before creating new one', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });
    const es1 = lastES();

    act(() => {
      result.current.start();
    });

    // First EventSource should have been closed
    expect(es1.close).toHaveBeenCalledOnce();
    // Second EventSource is a new instance
    expect(mockESInstances).toHaveLength(2);
  });

  it('9. reset() closes connection and resets state to idle', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });

    const es = lastES();

    // Emit a few events first so there is state to clear
    act(() => {
      emitSSE(es, stageStart(1 as StageNumber, 'Fetch'));
      emitSSE(es, jobPassed(1 as StageNumber, 1, 'Engineer'));
    });

    expect(result.current.state.events.length).toBeGreaterThan(0);

    act(() => {
      result.current.reset();
    });

    expect(es.close).toHaveBeenCalled();
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.events).toEqual([]);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.stageReports).toEqual({});
    expect(result.current.state.nextStage).toBeNull();
  });

  it('10. onerror handler closes EventSource in run-all mode', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });

    const es = lastES();

    act(() => {
      emitError(es);
    });

    expect(es.close).toHaveBeenCalledOnce();
    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toContain('Connection to backend failed');
  });
});

// ===========================================================================
// Step mode (startStep / nextStage / cancelStep)
// ===========================================================================

describe('step mode', () => {
  it('11. startStep() creates EventSource with /step/start URL', () => {
    const { result } = render();

    act(() => {
      result.current.startStep();
    });

    const es = lastES();
    expect(es.url).toBe('/api/run/test-token/step/start');
  });

  it('12. receiving stage-ready event sets status to awaiting_input with nextStage', () => {
    const { result } = render();

    act(() => {
      result.current.startStep();
    });

    const es = lastES();

    act(() => {
      emitSSE(es, stageReady(1 as StageNumber, 2 as StageNumber));
    });

    expect(result.current.state.status).toBe('awaiting_input');
    expect(result.current.state.nextStage).toBe(2);
  });

  it('13. nextStage() sends POST to /step/next and transitions back to running', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = render();

    act(() => {
      result.current.startStep();
    });

    const es = lastES();

    // Simulate stage-ready so we're in awaiting_input
    act(() => {
      emitSSE(es, stageReady(1 as StageNumber, 2 as StageNumber));
    });

    expect(result.current.state.status).toBe('awaiting_input');

    act(() => {
      result.current.nextStage();
    });

    // Status should immediately transition to 'running'
    expect(result.current.state.status).toBe('running');
    expect(result.current.state.nextStage).toBeNull();

    // fetch should have been called with the correct URL and method
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/run/test-token/step/next',
        { method: 'POST' },
      );
    });
  });

  it('14. nextStage() handles fetch error gracefully', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network down'));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = render();

    act(() => {
      result.current.startStep();
    });

    const es = lastES();

    act(() => {
      emitSSE(es, stageReady(1 as StageNumber, 2 as StageNumber));
    });

    act(() => {
      result.current.nextStage();
    });

    // Wait for the rejected promise microtask to settle
    await waitFor(() => {
      expect(result.current.state.status).toBe('error');
    });

    expect(result.current.state.error).toBe('Failed to advance to next stage.');
  });

  it('15. cancelStep() sends POST to /step/cancel and calls reset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = render();

    act(() => {
      result.current.startStep();
    });

    const es = lastES();

    act(() => {
      emitSSE(es, stageReady(1 as StageNumber, 2 as StageNumber));
    });

    act(() => {
      result.current.cancelStep();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/run/test-token/step/cancel',
        { method: 'POST' },
      );
    });

    // reset() should have been called in .finally()
    await waitFor(() => {
      expect(result.current.state.status).toBe('idle');
    });

    expect(es.close).toHaveBeenCalled();
  });

  it('16. onerror in step mode does NOT close EventSource when status is awaiting_input', () => {
    const { result } = render();

    act(() => {
      result.current.startStep();
    });

    const es = lastES();

    // Transition to awaiting_input first
    act(() => {
      emitSSE(es, stageReady(1 as StageNumber, 2 as StageNumber));
    });

    expect(result.current.state.status).toBe('awaiting_input');

    // Simulate a transient network blip
    act(() => {
      emitError(es);
    });

    // Should NOT close, should NOT change status to error
    expect(es.close).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe('awaiting_input');
  });

  it('17. onerror in step mode closes EventSource when transitioning to error', () => {
    const { result } = render();

    act(() => {
      result.current.startStep();
    });

    const es = lastES();

    // Still 'running' — simulate error
    act(() => {
      emitError(es);
    });

    expect(es.close).toHaveBeenCalledOnce();
    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toContain('Connection to backend failed');
  });
});

// ===========================================================================
// Event handling edge cases
// ===========================================================================

describe('event handling edge cases', () => {
  it('18. events after complete status are ignored', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });

    const es = lastES();

    act(() => {
      emitSSE(es, runComplete());
    });

    expect(result.current.state.status).toBe('complete');
    const eventCount = result.current.state.events.length;

    // Try to emit another event after complete
    act(() => {
      emitSSE(es, stageStart(2 as StageNumber, 'Should be ignored'));
    });

    // No new event should be added
    expect(result.current.state.events).toHaveLength(eventCount);
    expect(result.current.state.status).toBe('complete');
  });

  it('19. events after error status are ignored', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });

    const es = lastES();

    act(() => {
      emitSSE(es, runError(2 as StageNumber, 'Boom'));
    });

    expect(result.current.state.status).toBe('error');
    const eventCount = result.current.state.events.length;

    act(() => {
      emitSSE(es, stageComplete(3 as StageNumber, 10, 0));
    });

    expect(result.current.state.events).toHaveLength(eventCount);
    expect(result.current.state.status).toBe('error');
  });

  it('20. malformed JSON in event data is silently skipped (no crash)', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });

    const es = lastES();

    // Send garbage that isn't valid JSON
    act(() => {
      es.onmessage?.({ data: 'not-json{{{]}}}}' } as MessageEvent);
    });

    // No events should be added, no crash
    expect(result.current.state.events).toHaveLength(0);
    expect(result.current.state.status).toBe('running');

    // Valid events should still work afterward
    act(() => {
      emitSSE(es, stageStart(1 as StageNumber, 'Fetch'));
    });

    expect(result.current.state.events).toHaveLength(1);
  });

  it('21. multiple stage-complete events accumulate in stageReports correctly', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });

    const es = lastES();

    act(() => {
      emitSSE(es, stageComplete(1 as StageNumber, 5, 2));
    });

    act(() => {
      emitSSE(es, stageComplete(2 as StageNumber, 4, 1));
    });

    act(() => {
      emitSSE(es, stageComplete(3 as StageNumber, 3, 2));
    });

    expect(result.current.state.stageReports).toEqual({
      1: { passed: 5, rejected: 2 },
      2: { passed: 4, rejected: 1 },
      3: { passed: 3, rejected: 2 },
    });

    // Also verify events accumulated
    expect(result.current.state.events).toHaveLength(3);
  });

  it('22. job-passed and job-rejected events accumulate in events array', () => {
    const { result } = render();

    act(() => {
      result.current.start();
    });

    const es = lastES();

    act(() => {
      emitSSE(es, jobPassed(1 as StageNumber, 1, 'Frontend Engineer'));
      emitSSE(es, jobRejected(1 as StageNumber, 2, 'Old Role', 'Outdated'));
      emitSSE(es, jobPassed(2 as StageNumber, 1, 'Frontend Engineer'));
      emitSSE(es, jobRejected(2 as StageNumber, 3, 'Wrong Dept', 'Department mismatch'));
    });

    expect(result.current.state.events).toHaveLength(4);

    const passedEvents = result.current.state.events.filter(
      (e) => e.type === 'job-passed',
    );
    const rejectedEvents = result.current.state.events.filter(
      (e) => e.type === 'job-rejected',
    );

    expect(passedEvents).toHaveLength(2);
    expect(rejectedEvents).toHaveLength(2);
  });
});
