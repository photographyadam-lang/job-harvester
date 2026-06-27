/**
 * Discover route — GET /api/discover/:token
 *
 * Fetches all jobs for a company via the Greenhouse API and returns the
 * unique set of location names and department names found across the catalog.
 * No LLM calls are made; this is a lightweight read-only operation.
 *
 * This file contains no business logic. It calls `fetchJobs` and relays
 * results only.
 */

import { Router, type Request, type Response } from 'express';
import { fetchJobs, FetchError } from '../pipeline/stage1-fetch';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/discover/:token
// ---------------------------------------------------------------------------

router.get('/discover/:token', async (req: Request, res: Response) => {
  const { token } = req.params;

  try {
    const { jobs } = await fetchJobs(token as string);

    const locations = [...new Set(jobs.map((j) => j.location.name))]
      .filter((name) => name !== 'Unknown')
      .sort();

    const departments = [...new Set(jobs.map((j) => j.department.name))]
      .filter((name) => name !== 'Unknown')
      .sort();

    res.json({ locations, departments });
  } catch (err) {
    if (err instanceof FetchError) {
      res.status(502).json({ error: 'Greenhouse API error', detail: err.message });
    } else {
      res.status(500).json({ error: 'Internal server error', detail: String(err) });
    }
  }
});

export default router;
