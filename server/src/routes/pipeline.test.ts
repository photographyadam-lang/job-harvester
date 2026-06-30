/**
 * @jest-environment node
 *
 * Tests for pipeline SSE routes.
 *
 * All external calls (orchestrator, stepOrchestrator) are mocked.
 * No live HTTP requests.  Tests verify routing behaviour only (Rule 12).
 */

import { createApp } from '../server';
import request from 'supertest';
import type { EmitCallback, ReportCard, StageNumber } from '../types';

// ---------------------------------------------------------------------------
// Hoist-safe mocks (Jest hoists jest.mock calls above imports)
// ---------------------------------------------------------------------------

jest.mock('../pipeline/orchestrator', () => ({
  runPipeline: jest.fn(),
}));

jest.mock('../pipeline/stepOrchestrator', () => ({
  createStepSession: jest.fn(),
  startStepSession: jest.fn(),
  advanceStepSession: jest.fn(),
  cancelStepSession: jest.fn(),
}));

import { runPipeline } from '../pipeline/orchestrator';
import {
  createStepSession,
  startStepSession,
  advanceStepSession,
  cancelStepSession,
} from '../pipeline/stepOrchestrator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a raw SSE body string into an array of parsed JSON event objects. */
function parseSSE(raw: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  const chunks = raw.split('\n\n');
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          events.push(JSON.parse(line.slice(6)));
        } catch {
          /* skip malformed JSON */
        }
      }
    }
  }
  return events;
}

/** Minimal report card for use in mock events. */
const MOCK_REPORT_CARD: ReportCard = {
  stages: [{ stage: 1 as StageNumber, passedCount: 3, rejectedCount: 0 }],
  totalPassed: 3,
  totalRejected: 0,
  totalRuntimeMs: 42,
  estimatedCostUsd: 0.01,
  heuristicHits: 3,
  llmFallbacks: 0,
};

/**
 * Set up `runPipeline` mock to emit the five stage-start events, then
 * run-complete, then resolve.
 */
function mockRunPipelineSuccess() {
  (runPipeline as jest.Mock).mockImplementation(
    async (_token: string, emit: EmitCallback) => {
      emit({ type: 'stage-start', stage: 1 as StageNumber, label: 'Fetch' });
      emit({ type: 'stage-start', stage: 2 as StageNumber, label: 'Filter' });
      emit({ type: 'stage-start', stage: 3 as StageNumber, label: 'Extractor' });
      emit({ type: 'stage-start', stage: 4 as StageNumber, label: 'Gap Filter' });
      emit({ type: 'stage-start', stage: 5 as StageNumber, label: 'Scorer' });
      emit({ type: 'run-complete', reportCard: MOCK_REPORT_CARD, scoredJobs: [] });
    },
  );
}

/**
 * Set up `runPipeline` mock to emit a run-error event then reject.
 */
function mockRunPipelineError() {
  (runPipeline as jest.Mock).mockImplementation(
    async (_token: string, emit: EmitCallback) => {
      emit({ type: 'run-error', stage: 2 as StageNumber, error: 'test error' });
      throw new Error('test error');
    },
  );
}

/**
 * Configure the createStepSession mock to end the response on the next tick
 * so step/start success tests don't hang on the open SSE connection.
 */
function mockCreateStepSessionClosesResponse() {
  (createStepSession as jest.Mock).mockImplementation(
    (_token: string, res: { end: () => void }) => {
      setImmediate(() => res.end());
    },
  );
}

// ---------------------------------------------------------------------------
// Setup & teardown
// ---------------------------------------------------------------------------

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  jest.clearAllMocks();
  app = createApp();
});

// ---------------------------------------------------------------------------
// GET / POST /api/run/:token — Run All (SSE stream)
// ---------------------------------------------------------------------------

describe('GET /api/run/:token — Run All (SSE)', () => {
  test('returns SSE headers', async () => {
    mockRunPipelineSuccess();

    const res = await request(app).get('/api/run/test-token').buffer(true);

    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['connection']).toBe('keep-alive');
  });

  test('emits stage-start events for all 5 stages', async () => {
    mockRunPipelineSuccess();

    const res = await request(app).get('/api/run/test-token').buffer(true);
    const events = parseSSE(res.text);
    const stageStarts = events.filter((e) => e.type === 'stage-start');

    expect(stageStarts).toHaveLength(5);
    expect(stageStarts.map((e) => e.stage)).toEqual([1, 2, 3, 4, 5]);
  });

  test('emits run-complete and closes stream', async () => {
    mockRunPipelineSuccess();

    const res = await request(app).get('/api/run/test-token').buffer(true);
    const events = parseSSE(res.text);
    const lastEvent = events[events.length - 1];

    expect(lastEvent.type).toBe('run-complete');
    expect(lastEvent.reportCard).toBeDefined();
    expect(lastEvent.scoredJobs).toEqual([]);
  });

  test('returns run-error on pipeline failure', async () => {
    mockRunPipelineError();

    const res = await request(app).get('/api/run/test-token').buffer(true);
    const events = parseSSE(res.text);
    const errorEvent = events.find((e) => e.type === 'run-error');

    expect(errorEvent).toBeDefined();
    expect(errorEvent!.stage).toBe(2);
    expect(errorEvent!.error).toBe('test error');
  });

  test('POST /api/run/:token works identically to GET', async () => {
    mockRunPipelineSuccess();

    const res = await request(app).post('/api/run/test-token').buffer(true);
    const events = parseSSE(res.text);
    const stageStarts = events.filter((e) => e.type === 'stage-start');
    const completeEvent = events.find((e) => e.type === 'run-complete');

    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(stageStarts).toHaveLength(5);
    expect(completeEvent).toBeDefined();
  });

  test('runPipeline is called exactly once per request', async () => {
    mockRunPipelineSuccess();

    await request(app).get('/api/run/test-token').buffer(true);

    expect(runPipeline).toHaveBeenCalledTimes(1);
  });

  test('token with special characters is URL-decoded correctly', async () => {
    mockRunPipelineSuccess();

    await request(app).get('/api/run/special%2Ftoken').buffer(true);

    expect(runPipeline).toHaveBeenCalledWith(
      'special/token',
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// Step-mode endpoints
// ---------------------------------------------------------------------------

describe('Step-mode endpoints', () => {
  describe('POST /api/run/:token/step/start', () => {
    test('creates step session and runs Stage 1', async () => {
      mockCreateStepSessionClosesResponse();
      (startStepSession as jest.Mock).mockResolvedValue(undefined);

      await request(app)
        .post('/api/run/test-token/step/start')
        .buffer(true);

      expect(createStepSession).toHaveBeenCalledWith(
        'test-token',
        expect.any(Object),
        expect.any(Function),
      );
      expect(startStepSession).toHaveBeenCalledWith('test-token');
    });

    test('returns SSE headers', async () => {
      mockCreateStepSessionClosesResponse();
      (startStepSession as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/run/test-token/step/start')
        .buffer(true);

      expect(res.headers['content-type']).toBe('text/event-stream');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['connection']).toBe('keep-alive');
    });

    test('emits run-error when startStepSession fails', async () => {
      (startStepSession as jest.Mock).mockRejectedValue(
        new Error('test step error'),
      );

      // When startStepSession rejects, handleStepStart calls finish() so
      // the stream ends and we can await the full response.
      const res = await request(app)
        .post('/api/run/test-token/step/start')
        .buffer(true);

      const events = parseSSE(res.text);
      const errorEvent = events.find((e) => e.type === 'run-error');

      expect(errorEvent).toBeDefined();
      expect(errorEvent!.stage).toBe(1);
      expect(errorEvent!.error).toBe('test step error');
    });

    test('GET /api/run/:token/step/start also works', async () => {
      mockCreateStepSessionClosesResponse();
      (startStepSession as jest.Mock).mockResolvedValue(undefined);

      await request(app)
        .get('/api/run/test-token/step/start')
        .buffer(true);

      expect(createStepSession).toHaveBeenCalledWith(
        'test-token',
        expect.any(Object),
        expect.any(Function),
      );
      expect(startStepSession).toHaveBeenCalledWith('test-token');
    });
  });

  describe('POST /api/run/:token/step/next', () => {
    test('returns { ok: true } on success', async () => {
      (advanceStepSession as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app).post(
        '/api/run/test-token/step/next',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    test('returns 500 with error message on failure', async () => {
      (advanceStepSession as jest.Mock).mockRejectedValue(
        new Error('step advance blew up'),
      );

      const res = await request(app).post(
        '/api/run/test-token/step/next',
      );

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'step advance blew up' });
    });
  });

  describe('POST /api/run/:token/step/cancel', () => {
    test('calls cancelStepSession and returns { ok: true }', async () => {
      const res = await request(app).post(
        '/api/run/test-token/step/cancel',
      );

      expect(cancelStepSession).toHaveBeenCalledWith('test-token');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });
});
