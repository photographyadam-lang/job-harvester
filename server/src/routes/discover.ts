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
import { loadCompanyConfig, resolveBoardToken } from '../config/companyConfig';
import type { FrequencyItem } from '../types';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/discover/:token
// ---------------------------------------------------------------------------

router.get('/discover/:token', async (req: Request, res: Response) => {
  const { token } = req.params;

  try {
    // Resolve the effective Greenhouse board token.
    // If the company config file exists, use its boardToken field (or fall back
    // to the token).  If the config file doesn't exist yet, use the raw token.
    let boardToken = token as string;
    try {
      const companyConfig = loadCompanyConfig(token as string);
      boardToken = resolveBoardToken(companyConfig, token as string);
    } catch {
      // Config file doesn't exist — use raw token as board token
    }
    const { jobs } = await fetchJobs(boardToken);

    // Build frequency counts for locations (split by pipe or semicolon).
    // Greenhouse uses pipe-delimited ("San Francisco, CA | Seattle, WA") for
    // multi-location jobs; semicolons are a legacy fallback.
    const locationCounts = new Map<string, number>();
    for (const job of jobs) {
      for (const part of job.location.name.split(/[|;]/)) {
        const name = part.trim();
        if (name === 'Unknown' || name.length === 0) continue;
        locationCounts.set(name, (locationCounts.get(name) ?? 0) + 1);
      }
    }
    const locations: FrequencyItem[] = [...locationCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Build frequency counts for departments.
    const departmentCounts = new Map<string, number>();
    for (const job of jobs) {
      const name = job.department.name;
      if (name === 'Unknown') continue;
      departmentCounts.set(name, (departmentCounts.get(name) ?? 0) + 1);
    }
    const departments: FrequencyItem[] = [...departmentCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

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
