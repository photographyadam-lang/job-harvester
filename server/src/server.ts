/**
 * Express application entrypoint.
 *
 * Mounts three route groups:
 *   1. SSE pipeline endpoint  – POST /api/run/:token
 *   2. Config read/write      – GET/PUT /api/config/company/:token,
 *                               GET/PUT /api/config/profile,
 *                               GET /api/companies
 *   3. Static serving          – Serves the React production build
 *
 * This file contains no business logic. Route files call `runPipeline` or
 * config loaders and relay results only.
 */

import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';

// ---------------------------------------------------------------------------
// Load .env from monorepo root (two levels up from server/src/).
// When the server workspace is run via `npm run dev --workspace=server`,
// process.cwd() is server/ — but .env lives at the monorepo root.
// ---------------------------------------------------------------------------
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
import pipelineRoutes from './routes/pipeline';
import configRoutes from './routes/config';
import discoverRoutes from './routes/discover';

// ---------------------------------------------------------------------------
// App factory (exported for testing)
// ---------------------------------------------------------------------------

export function createApp(): express.Application {
  const app = express();

  // -------------------------------------------------------------------------
  // Middleware
  // -------------------------------------------------------------------------
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // -------------------------------------------------------------------------
  // API routes
  // -------------------------------------------------------------------------
  app.use('/api', pipelineRoutes);
  app.use('/api', configRoutes);
  app.use('/api', discoverRoutes);

  // -------------------------------------------------------------------------
  // Static serving (production only)
  // -------------------------------------------------------------------------
  if (process.env.NODE_ENV === 'production') {
    const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
    app.use(express.static(clientDist));

    // SPA fallback — serve index.html for any non-API route
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}

// ---------------------------------------------------------------------------
// Main — only run when executed directly (not imported by tests)
// ---------------------------------------------------------------------------

if (require.main === module) {
  const PORT = parseInt(process.env.PORT ?? '3001', 10);
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`Job Harvester server listening on http://localhost:${PORT}`);
  });
}
