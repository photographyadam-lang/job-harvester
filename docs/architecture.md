# Job Harvester — Architecture Guide

> This document is intended for LLM agents or human developers who need to understand the codebase to make improvements. It covers the system architecture, data flow, key design decisions, and extension points.

---

## 1. Overview

Job Harvester is a full-stack TypeScript application that automates the process of finding relevant job postings from [Greenhouse](https://www.greenhouse.io/) job boards. It runs a 5-stage pipeline that:

1. **Fetches** jobs from a company's Greenhouse board
2. **Filters** them by department (metadata filter)
3. **Extracts** must-have and nice-to-have requirements from job descriptions (heuristic + LLM fallback)
4. **Gap-filters** by comparing extracted requirements against the user's skills profile
5. **Scores** remaining jobs using DeepSeek AI

The server streams real-time progress to the React client via Server-Sent Events (SSE).

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js v18+ |
| Backend framework | Express.js (v5) |
| Frontend framework | React 19 with TypeScript |
| Build tool (client) | Vite 6 |
| Language | TypeScript (strict mode) |
| LLM provider | DeepSeek Chat API (via OpenAI-compatible SDK) |
| HTML processing | `he` library (entity decoding) |
| Testing | Jest + ts-jest |
| Monorepo tool | npm workspaces |

---

## 3. Project Structure

```
job-harvester/
├── client/                          # React + Vite frontend (workspace: "client")
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts               # Dev server proxy /api -> localhost:3001
│   └── src/
│       ├── main.tsx                 # React entrypoint
│       ├── App.tsx                  # Root component, owns all UI state
│       ├── components/
│       │   ├── CompanySelector.tsx   # Dropdown to pick a company token
│       │   ├── ConfigEditor.tsx      # Editable company config + skills profile
│       │   ├── JobRow.tsx            # Single job row (passed/rejected)
│       │   ├── ReportCard.tsx        # Post-run summary statistics
│       │   ├── RunControls.tsx       # Run/Reset buttons
│       │   ├── ScoredJobsList.tsx    # Final ranked job list
│       │   └── StagePanel.tsx        # Per-stage live panel
│       ├── hooks/
│       │   └── usePipelineStream.ts  # SSE connection & event accumulation
│       └── types/
│           └── events.ts            # Client-side event type definitions
│
├── server/                          # Express + TypeScript backend (workspace: "server")
│   ├── package.json
│   ├── tsconfig.json
│   ├── jest.config.js
│   ├── __fixtures__/                # Test fixtures (mock API responses)
│   │   ├── config/                  #   Fixture company configs
│   │   └── figma-api-response.json  #   Mock Greenhouse API response
│   ├── config/
│   │   └── companies/
│   │       └── figma.json           # Company-specific configuration
│   ├── profile/
│   │   └── adam.json                # User's skills profile
│   └── src/
│       ├── index.ts                 # Placeholder (no app logic here)
│       ├── server.ts                # Express app factory + main()
│       ├── types/
│       │   ├── index.ts             # SINGLE SOURCE OF TRUTH for shared interfaces
│       │   └── he.d.ts              # Type declarations for `he` library
│       ├── routes/
│       │   ├── pipeline.ts          # GET/POST /api/run/:token (SSE endpoint)
│       │   └── config.ts            # Config CRUD routes
│       ├── config/
│       │   ├── types.ts             # CompanyConfig & SkillsProfile interfaces (file-format contracts)
│       │   ├── companyConfig.ts     # Load & validate company config files
│       │   ├── companyConfig.test.ts
│       │   ├── skillsProfile.ts     # Load & validate skills profile
│       │   └── skillsProfile.test.ts
│       ├── pipeline/
│       │   ├── orchestrator.ts      # Runs stages 1→5 in sequence, emits events
│       │   ├── orchestrator.test.ts
│       │   ├── normalizer.ts        # HTML → Markdown conversion (pure function)
│       │   ├── normalizer.test.ts
│       │   ├── stage1-fetch.ts      # Stage 1: Fetch from Greenhouse API
│       │   ├── stage1-fetch.test.ts
│       │   ├── stage2-filter.ts     # Stage 2: Metadata filter (pure)
│       │   ├── stage2-filter.test.ts
│       │   ├── stage3-extractor.ts  # Stage 3: Requirement extraction (heuristic + LLM)
│       │   ├── stage3-extractor.test.ts
│       │   ├── stage4-gap-filter.ts # Stage 4: Skill gap filter (pure)
│       │   ├── stage4-gap-filter.test.ts
│       │   ├── stage5-scorer.ts     # Stage 5: AI scoring (LLM)
│       │   └── stage5-scorer.test.ts
│       ├── llm/
│       │   ├── deepseekClient.ts    # DeepSeek API client (rate-limited)
│       │   ├── deepseekClient.test.ts
│       │   ├── schemaValidator.ts   # Response schema validation
│       │   ├── schemaValidator.test.ts
│       │   ├── costEstimator.ts     # Token cost estimation
│       │   └── costEstimator.test.ts
│       └── output/
│           ├── dedupCache.ts        # Processed-job dedup cache
│           ├── dedupCache.test.ts
│           ├── runPersister.ts      # Pipeline output file writer
│           └── runPersister.test.ts
│
├── docs/                            # Documentation
│   ├── readme.md                    # User-facing setup & usage guide
│   └── architecture.md              # This file
│
├── output/                          # Runtime output directory (git-ignored)
├── .env.example                     # Environment variable template
├── .env                             # Local env vars (git-ignored)
├── package.json                     # Workspace root
├── AGENTS.md                        # Rules for AI coding agents
├── SESSIONSTATE.md                  # Active task tracking for agents
├── SPECIFICATION.md                 # Technical specification (template)
├── TASKS.md                         # Task list
└── TASKS-COMPLETED.md               # Completed task log
```

---

## 4. Architecture Diagram (Textual)

```
┌─────────────┐     SSE stream      ┌─────────────────────────────────────────────┐
│  React App  │ ◄────────────────── │  Express Server (port 3001)                │
│  (Vite dev  │     /api/run/:token  │                                             │
│   :5173)    │                      │  ┌─────────────────────────────────────┐   │
│             │  ---- HTTP ------>   │  │  Routes                              │   │
│             │  GET /api/config/*   │  │  ├── pipeline.ts → runPipeline()     │   │
│             │  PUT /api/config/*   │  │  └── config.ts   → CRUD config files │   │
│             │  GET /api/companies  │  └─────────────────────────────────────┘   │
│             │                      │                                             │
│             │                      │  ┌─────────────────────────────────────┐   │
│             │                      │  │  Orchestrator (runPipeline)          │   │
│             │                      │  │                                     │   │
│             │                      │  │  Stage 1: fetchJobs()               │   │
│             │                      │  │     ↓ (RawJob[])                     │   │
│             │                      │  │  Stage 2: filterJobs()              │   │
│             │                      │  │     ↓ (FilteredJob[])                │   │
│             │                      │  │  [Dedup cache check]                 │   │
│             │                      │  │     ↓                               │   │
│             │                      │  │  Stage 3: extractJobs()             │   │
│             │                      │  │     ├── normalizeJobHtml() [pure]    │   │
│             │                      │  │     ├── Heuristic extraction         │   │
│             │                      │  │     └── LLM fallback (DeepSeek)      │   │
│             │                      │  │     ↓ (ExtractedJob[])               │   │
│             │                      │  │  Stage 4: filterByGap() [pure]      │   │
│             │                      │  │     ↓ (GatedJob[])                   │   │
│             │                      │  │  Stage 5: scoreJobs()               │   │
│             │                      │  │     └── DeepSeek LLM per job         │   │
│             │                      │  │     ↓ (ScoredJob[])                  │   │
│             │                      │  │                                     │   │
│             │                      │  │  markProcessed() + persistRun()     │   │
│             │                      │  └─────────────────────────────────────┘   │
│             │                      │                                             │
│             │                      │  ┌─────────────────────────────────────┐   │
│             │                      │  │  Dependencies                        │   │
│             │                      │  │  ├── config/companyConfig.ts         │   │
│             │                      │  │  ├── config/skillsProfile.ts         │   │
│             │                      │  │  ├── llm/deepseekClient.ts           │   │
│             │                      │  │  ├── pipeline/normalizer.ts          │   │
│             │                      │  │  ├── output/dedupCache.ts            │   │
│             │                      │  │  └── output/runPersister.ts          │   │
│             │                      │  └─────────────────────────────────────┘   │
│             │                      └─────────────────────────────────────────────┘
```

---

## 5. Server Architecture

### 5.1 Express App Factory ([`server/src/server.ts`](../server/src/server.ts))

The server uses an app factory pattern — `createApp()` returns a configured Express app. This enables testing without binding to a port. The main `if (require.main === module)` guard starts the server on port 3001 (configurable via `PORT` env var).

**Middleware stack:**
1. `cors()` — Cross-Origin Resource Sharing
2. `express.json({ limit: '1mb' })` — JSON body parsing
3. API routes (`/api`)
4. Static file serving (production only) — serves `client/dist/` with SPA fallback

### 5.2 Routes

**Pipeline routes** ([`server/src/routes/pipeline.ts`](../server/src/routes/pipeline.ts)):
- `GET /api/run/:token` and `POST /api/run/:token`
- Sets SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`)
- Creates an `emit` callback that writes `data: {eventJson}\n\n` to the response stream
- Calls `runPipeline(token, emit)` and handles client disconnect

**Config routes** ([`server/src/routes/config.ts`](../server/src/routes/config.ts)):
- `GET /api/companies` — Lists available company tokens by scanning the config directory
- `GET /api/config/company/:token` — Loads a company config via `loadCompanyConfig()`
- `PUT /api/config/company/:token` — Writes config to disk, validates by reloading, rolls back on failure
- `GET /api/config/profile` — Loads the skills profile via `loadSkillsProfile()`
- `PUT /api/config/profile` — Same write-with-rollback pattern as company config

**Rule:** Route files contain no business logic — they call config loaders or `runPipeline` and relay results.

### 5.3 Pipeline Orchestrator ([`server/src/pipeline/orchestrator.ts`](../server/src/pipeline/orchestrator.ts))

The orchestrator `runPipeline(companyToken, emit)` is the core control flow:

1. **Load configs** — `loadCompanyConfig(companyToken)` and `loadSkillsProfile()`
2. **Build FilterConfig** — Extracts department list from company config
3. **Stage 1** — `fetchJobs(companyToken)` → RawJob[]
4. **Stage 2** — `filterJobs(rawJobs, filterConfig)` → FilteredJob[] (throws `ConfigMismatchError` if zero jobs pass)
5. **Dedup check** — Filters out already-processed jobs via `isProcessed()`
6. **Stage 3** — `extractJobs(dedupFiltered, companyConfig, companyName)` → ExtractedJob[]
7. **Stage 4** — `filterByGap(extractedJobs, skillsProfile)` → GatedJob[]
8. **Stage 5** — `scoreJobs(gatedJobs, skillsProfile)` → ScoredJob[]
9. **Compute ReportCard** — Aggregates per-stage stats, runtime, cost
10. **Mark processed** — `markProcessed()` for each scored job
11. **Persist** — `persistRun(output)` writes to `output/{company}-{date}.json`
12. **Emit** — `run-complete` event with summary data for the client

**Rules:**
- Stages communicate only through typed return values (no shared state)
- No stage module may import from another stage module
- The orchestrator is the only module that calls stage functions

### 5.4 Pipeline Stages

#### Stage 1 — Fetch ([`server/src/pipeline/stage1-fetch.ts`](../server/src/pipeline/stage1-fetch.ts))

- Calls the Greenhouse Boards API: `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`
- Returns `FetchResult { jobs: RawJob[], rawCount: number }`
- Throws `FetchError` on network failure, non-200, invalid JSON, or empty jobs array
- No test may make a live HTTP request — tests mock the fetch call

#### Stage 2 — Metadata Filter ([`server/src/pipeline/stage2-filter.ts`](../server/src/pipeline/stage2-filter.ts))

- A **pure function** — no I/O, no network, no side effects
- Applies three sequential filters: location (substring), department (exact match), keyword (title substring)
- Each filter is case-insensitive
- Returns `StageResult<FilteredJob>` with `passed` and `rejected` arrays
- Throws `ConfigMismatchError` if zero jobs survive
- Filter config is pre-validated by the orchestrator before being passed in

#### Stage 3 — Extractor ([`server/src/pipeline/stage3-extractor.ts`](../server/src/pipeline/stage3-extractor.ts))

For each job:
1. **Normalize** — Converts raw job HTML to Markdown via `normalizeJobHtml()` (pure function)
2. **Heuristic extraction** — Scans Markdown for `###` headings matching configured keywords, extracts bullet-point items underneath them. If BOTH must-have and nice-to-have sections are found → heuristic hit
3. **LLM fallback** — If heuristic misses, calls DeepSeek with a structured extraction prompt
4. **Error handling** — On normalization, schema, or API errors, the job is rejected (not fatal — processing continues for remaining jobs)

Returns `Stage3Result` with `passed: ExtractedJob[]`, `rejected: RejectedJob[]`, and extraction statistics.

#### Stage 4 — Gap Filter ([`server/src/pipeline/stage4-gap-filter.ts`](../server/src/pipeline/stage4-gap-filter.ts))

- A **pure function** — no I/O, no LLM calls, no side effects
- For each job, compares must-have requirements against the user's skills profile
- `matchSkill()` does case-insensitive substring matching against skill name and optional aliases
- `computeGapRatio()` returns the fraction of must-haves that are unmatched
- Jobs with `gapRatio >= profile.gapThreshold` are rejected (with a reason listing unmatched skills)
- Passing jobs are enriched with `gapRatio`, `matchedSkills[]`, and `unmatchedSkills[]`

#### Stage 5 — Scorer ([`server/src/pipeline/stage5-scorer.ts`](../server/src/pipeline/stage5-scorer.ts))

- For each gated job, sends a structured prompt to DeepSeek requesting a 1–10 score and one sentence of reasoning
- The prompt includes job details, extracted requirements, gap analysis, and the user's full skills profile
- Scores are sorted descending before returning
- Returns `Stage5Result` with `scoredJobs`, `rejected`, and scoring statistics
- Failed LLM calls or schema validation errors result in job rejection (not fatal)

### 5.5 Normalizer ([`server/src/pipeline/normalizer.ts`](../server/src/pipeline/normalizer.ts))

A pure function that converts raw Greenhouse HTML to clean Markdown:

1. HTML entity decoding (via `he` library — required dependency, not hand-rolled)
2. Mojibake repair (UTF-8 / Latin-1 corruption patterns)
3. Truncation at `content-conclusion` div
4. Structural tag conversion (`<h4>` → `###`, `<li>` → `*`)
5. Strip remaining HTML tags
6. Collapse blank lines
7. Trim

Throws `NormalizationError` if the result is empty.

### 5.6 LLM Integration ([`server/src/llm/deepseekClient.ts`](../server/src/llm/deepseekClient.ts))

- Uses the `openai` npm package with `baseURL: 'https://api.deepseek.com'` and `model: 'deepseek-chat'`
- Reads `DEEPSEEK_API_KEY` from `process.env` only — never hardcoded or in config files
- Enforces a **minimum 1500ms delay** between consecutive calls via an internal rate limiter
- Validates responses against a supplied JSON schema
- On API failure, throws `LlmApiError`; on schema validation failure, throws `LlmSchemaError`
- Never logs full response content — only token counts and cost
- Supports dependency injection via `setMockClient()` for testing

### 5.7 Config System ([`server/src/config/`](../server/src/config/))

Two types of configuration files, each with its own loader and validator:

**Company Config** (`config/companies/{token}.json`): Company name, allowed departments, section header keywords for extraction.

**Skills Profile** (`profile/adam.json`): User's skill inventory with strength levels and gap threshold.

Both loaders:
- Validate required fields and types
- Throw `ConfigValidationError` on missing/malformed files
- Are called by the orchestrator (stage modules never call them directly — Rule 10)

### 5.8 Output Persistence ([`server/src/output/`](../server/src/output/))

**Dedup Cache** (`dedupCache.ts`): Reads/writes `output/processed_ids.json`. Used between Stage 2 and Stage 3 to skip already-processed jobs.

**Run Persister** (`runPersister.ts`): Writes completed pipeline runs to `output/{company}-{YYYY-MM-DD}.json`. Returns the absolute file path.

Only these two modules may write to the `output/` directory (Rule 18).

---

## 6. Client Architecture

### 6.1 Component Tree

```
<App>
  ├── <CompanySelector />           # Dropdown, fetches /api/companies
  ├── <ConfigEditor />              # Inline editable company config + skills profile
  ├── <RunControls />               # Run Pipeline / Reset buttons
  ├── <StagePanel> x5               # One per pipeline stage (live-updating)
  │     └── <JobRow> xN            # Individual job entries (passed/rejected)
  ├── <ReportCard />                # Post-run summary (shown on run-complete)
  └── <ScoredJobsList />           # Ranked job list (shown on run-complete)
       └── individual job cards     # Score badge, reasoning, skills breakdown
```

### 6.2 SSE Streaming Hook ([`client/src/hooks/usePipelineStream.ts`](../client/src/hooks/usePipelineStream.ts))

- Accepts a `token` string
- Exposes `{ state, start, reset }`
- `start()` creates an `EventSource` connection to `/api/run/{token}`
- Accumulates `PipelineEvent` objects in chronological order
- Automatically handles terminal states (`complete`, `error`)
- `reset()` closes the connection and clears all state
- Single source of truth for all SSE interaction — no component connects to `EventSource` directly

### 6.3 State Management

The app uses React's built-in `useState` and `useMemo` — no external state management library. The `App` component derives `StageData[]`, `ReportCard`, and `ScoredJobSummary[]` from the flat event list via `useMemo`.

**Status flow:** `idle` → `running` → `complete` | `error`

### 6.4 Client-Side Types ([`client/src/types/events.ts`](../client/src/types/events.ts))

A self-contained mirror of the server's event types. Duplicated intentionally (not imported from the server workspace) to keep the client independent. These must be kept in sync manually with `server/src/types/index.ts`.

### 6.5 Vite Config ([`client/vite.config.ts`](../client/vite.config.ts))

- Dev server on port 5173
- Proxies `/api/*` requests to `http://localhost:3001`
- Uses the `@vitejs/plugin-react` plugin for React JSX transform

---

## 7. Data Flow

### 7.1 Pipeline Run Flow

```
User clicks "Run Pipeline"
        │
        ▼
Client: EventSource → GET /api/run/figma
        │
        ▼
Server: set SSE headers → runPipeline("figma", emit)
        │
        ▼
Server streams events:
  ├── { type: "stage-start", stage: 1, label: "Fetch jobs" }
  ├── { type: "job-passed", stage: 1, job: { id, title, url } }  ← for each job
  ├── { type: "stage-complete", stage: 1, report: { passedCount, rejectedCount } }
  ├── { type: "stage-start", stage: 2, label: "Metadata filter" }
  ├── { type: "job-passed", stage: 2, job: {...} }
  ├── { type: "job-rejected", stage: 2, job: {...} }
  ├── { type: "stage-complete", stage: 2, report: {...} }
  ├── ... (stages 3-5)
  └── { type: "run-complete", reportCard: {...}, scoredJobs: [...] }
        │
        ▼
Server: persistRun() → writes output/figma-2026-06-26.json
Server: markProcessed() for each scored job
        │
        ▼
Client: Renders ReportCard + ScoredJobsList
```

### 7.2 Type Transformation Through Pipeline Stages

```
RawJob (Greenhouse API shape)
  │ Stage 1: fetch
  ▼
RawJob[]
  │ Stage 2: filter (location, department, keyword)
  ▼
FilteredJob[]  (flattened: location.name → location, department.name → department)
  │ Dedup check
  ▼
FilteredJob[] (already-processed jobs removed)
  │ Stage 3: extract (heuristic + LLM)
  ▼
ExtractedJob[] (FilteredJob + requirements: { must_haves, nice_to_haves })
  │ Stage 4: gap filter
  ▼
GatedJob[] (ExtractedJob + gapRatio, matchedSkills, unmatchedSkills)
  │ Stage 5: score (LLM)
  ▼
ScoredJob[] (GatedJob + score, scoreReasoning), sorted descending
```

---

## 8. Key Design Decisions

### 8.1 Monorepo with npm Workspaces

The `server` and `client` are separate workspaces in a single repo. This allows independent build configurations (`tsconfig.json`), dependency management, and test suites while sharing the root `node_modules` for common dev dependencies.

### 8.2 No Stage-to-Stage Imports (Rule 11)

Each stage module is independent. The orchestrator is the only module that knows about all five stages. This prevents circular dependencies and makes each stage testable in isolation.

### 8.3 Pre-Validated Config Objects (Rule 10)

Stage modules receive already-validated config objects as function arguments. They never call `loadCompanyConfig`, `loadSkillsProfile`, or any file-reading function directly. This keeps stages pure (or pure-ish) and simplifies testing.

### 8.4 Single Source of Truth for Types (Rule 9)

All shared interfaces (RawJob, FilteredJob, ExtractedJob, GatedJob, ScoredJob, PipelineEvent, ReportCard, etc.) are defined in `server/src/types/index.ts`. This file is the contract. The client maintains a manually-synced mirror.

### 8.5 SSE for Real-Time Updates

Instead of polling or WebSockets, the server streams pipeline progress as Server-Sent Events. This is simpler than WebSockets (unidirectional, native browser support via `EventSource`) and more efficient than polling.

### 8.6 Two-Tier Extraction (Heuristic + LLM)

Stage 3 tries a fast, free heuristic first (Markdown heading parsing) and only falls back to the paid DeepSeek API when the heuristic can't find both requirement sections. This reduces cost. The heuristic hit rate is tracked in the report card.

### 8.7 Rate-Limited LLM Calls

The DeepSeek client enforces a 1500ms minimum delay between consecutive calls to avoid rate limiting and manage API costs.

### 8.8 Write-With-Rollback for Config

The config PUT endpoints write the incoming JSON to disk first, then validate by reloading. If validation fails, the previous content is restored. This prevents corrupt config files from breaking the pipeline.

---

## 9. Critical Rules (from [`AGENTS.md`](../AGENTS.md))

1. **Exit criterion for Phase 2/3 tasks:** `npm test --workspace=server` clean. Never mark a task done based on manual testing or self-report alone.
2. **No live network calls in tests:** All tests use fixtures in `server/__fixtures__/` or mock the relevant HTTP client.
3. **`DEEPSEEK_API_KEY` lives in `.env` only:** Never in config JSON files, TypeScript source, logs, or API responses.
4. **Test-first for Phase 2:** Write failing tests first, confirm they fail, then implement.
5. **Windows/PowerShell specifics:** Use `;` as command separator, `curl.exe` not `curl`, `Select-String` not `grep`.
6. **`he` library is required for HTML entity decoding:** No hand-rolled entity decoder.

---

## 10. Extension Points

### Adding a New Company

1. Create `server/config/companies/{token}.json` with company name, departments, and section headers
2. The company will appear automatically in the UI dropdown (via `GET /api/companies`)
3. Optionally add a fixture at `server/__fixtures__/config/{token}.json`

### Modifying a Pipeline Stage

- Each stage has a single entry point function with a typed signature
- The orchestrator passes data and receives typed results
- To add/remove a stage: modify the orchestrator's sequence in `runPipeline()`
- Update `server/src/types/index.ts` if the stage input/output types change

### Adding a New Pipeline Stage

1. Define input/output types in `server/src/types/index.ts`
2. Create `server/src/pipeline/stageN-name.ts` with the stage function
3. Add the stage call to the orchestrator's `runPipeline()` sequence
4. Update the client's event types in `client/src/types/events.ts` if emitting new event types
5. Write tests in `stageN-name.test.ts`

### Adding New Configuration

- Add fields to the relevant config type in `server/src/config/types.ts`
- Update the validator in the corresponding loader
- Update the UI's `ConfigEditor` component to render and save the new fields
- (The server validates at write time, so invalid configs can't be saved)

### Adding a New LLM Provider

- The `deepseekClient.ts` module is the single point of LLM interaction
- Create a new client following the same interface
- Swap implementations in `callDeepSeek` or add provider selection logic

---

## 11. Testing Strategy

- **Framework:** Jest with ts-jest
- **Location:** Test files co-located with source files (`*.test.ts`)
- **Fixtures:** `server/__fixtures__/` for mock API responses and config files
- **Mocking:** `setMockClient()` for DeepSeek client; manual mocks for fetch calls
- **No network:** All HTTP interactions are mocked — no test calls Greenhouse or DeepSeek live
- **Coverage:** Every stage module, config loader, utility function, and route has tests
- **Command:** `npm test --workspace=server` (must pass clean before marking tasks complete)
