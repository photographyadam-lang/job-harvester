/**
 * Pipeline SSE routes.
 *
 * - GET/POST /api/run/:token              — Run all stages (SSE stream)
 * - POST     /api/run/:token/step/start   — Start step mode, run Stage 1, keep SSE open
 * - POST     /api/run/:token/step/next    — Advance to next stage in step mode
 * - POST     /api/run/:token/step/cancel  — Cancel step mode session
 *
 * This file contains no business logic. It calls `runPipeline` or step
 * orchestrator functions and relays results via SSE / JSON only.
 */

import { Router, type Request, type Response } from 'express';
import { runPipeline } from '../pipeline/orchestrator';
import {
  createStepSession,
  startStepSession,
  advanceStepSession,
  cancelStepSession,
} from '../pipeline/stepOrchestrator';
import type { PipelineEvent } from '../types';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

function makeEmit(res: Response) {
  return (event: PipelineEvent): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

function makeFinish(res: Response) {
  let finished = false;
  return (): void => {
    if (!finished) {
      finished = true;
      res.end();
    }
  };
}

// ---------------------------------------------------------------------------
// GET / POST /api/run/:token  — Run All (existing behaviour)
// ---------------------------------------------------------------------------

async function handleRun(req: Request, res: Response): Promise<void> {
  const { token } = req.params;

  sseHeaders(res);

  const emit = makeEmit(res);
  const finish = makeFinish(res);

  req.on('close', finish);

  try {
    await runPipeline(token as string, emit);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown pipeline error';
    emit({ type: 'run-error', stage: 2, error: message });
  } finally {
    finish();
  }
}

router.get('/run/:token', handleRun);
router.post('/run/:token', handleRun);

// ---------------------------------------------------------------------------
// POST /api/run/:token/step/start  — Start step mode
// ---------------------------------------------------------------------------

async function handleStepStart(req: Request, res: Response): Promise<void> {
  const { token } = req.params;

  sseHeaders(res);

  const emit = makeEmit(res);
  const finish = makeFinish(res);

  req.on('close', finish);

  // Create the session (writes SSE headers, loads configs)
  createStepSession(token as string, res, emit);

  // Run Stage 1 — this emits stage-start(1), job-passed, stage-complete(1),
  // and stage-ready(1).  The connection stays open for subsequent stages.
  try {
    await startStepSession(token as string);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown step pipeline error';
    // If an error happened before stage-ready was emitted, emit run-error
    emit({ type: 'run-error', stage: 1, error: message });
    finish();
  }
  // NOTE: Do NOT call finish() here — the connection stays open for
  //       subsequent step/next calls.
}

router.get('/run/:token/step/start', handleStepStart);
router.post('/run/:token/step/start', handleStepStart);

// ---------------------------------------------------------------------------
// POST /api/run/:token/step/next  — Advance to next stage
// ---------------------------------------------------------------------------

async function handleStepNext(req: Request, res: Response): Promise<void> {
  const { token } = req.params;

  try {
    await advanceStepSession(token as string);
    res.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown step advance error';
    res.status(500).json({ error: message });
  }
}

router.post('/run/:token/step/next', handleStepNext);

// ---------------------------------------------------------------------------
// POST /api/run/:token/step/cancel  — Cancel step mode
// ---------------------------------------------------------------------------

async function handleStepCancel(req: Request, res: Response): Promise<void> {
  const { token } = req.params;

  cancelStepSession(token as string);
  res.json({ ok: true });
}

router.post('/run/:token/step/cancel', handleStepCancel);

export default router;
