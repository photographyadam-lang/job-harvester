# Job Matching Pipeline — Phase Task List

> Tasks are ordered by dependency. Do not start a task until all
> prerequisites are met.

---

## Phase structure

| Phase                         | Description                                                  | Status  |
| ----------------------------- | ------------------------------------------------------------ | ------- |
| **Phase 1 — Foundation**      | Monorepo scaffold, shared type contracts, config loaders, and Greenhouse fixture | Pending |
| **Phase 2 — Pipeline Stages** | Five independently tested stage modules plus DeepSeek client and output persistence | Pending |
| **Phase 3 — Server**          | Pipeline orchestrator and Express server with SSE streaming and config API | Pending |
| **Phase 4 — React UI**        | Live browser interface with company selector, stage panels, report card, and config editor | Pending |

---

# Phase 1 — Foundation

**Status:** ✅ Complete

Establish the monorepo, lock all shared data contracts, build validated config
loaders, and capture a real Greenhouse fixture. Nothing in Phase 2 begins until
`npm test --workspace=server` is clean and the fixture file exists on disk.

---

## Phase 1 tasks

### P1-T01 · Monorepo Scaffold

**Status:** ✅ Complete
**Complexity:** low
**What:** Initialise the monorepo with two workspaces (`server`, `client`), TypeScript
  configs, Jest test runner, and npm scripts. No application logic. No pipeline code.
**Prerequisite:** None.
**Hard deps:** None
**Files:** `package.json` (new), `server/package.json` (new), `server/tsconfig.json` (new),
  `server/jest.config.ts` (new), `client/package.json` (new), `client/vite.config.ts` (new),
  `client/tsconfig.json` (new), `client/index.html` (new), `client/src/main.tsx` (new),
  `client/src/App.tsx` (new), `.env.example` (new), `.gitignore` (new)
**Reviewer:** Skip
**Key constraints:**

- `server/tsconfig.json` must set `strict: true`, `target: ES2022`, `module: CommonJS`.
- `client/App.tsx` returns a minimal placeholder only — no application components.
- Root `package.json` must declare `workspaces: ["server", "client"]`.

**Done when:**

- `npm run build --workspace=server` exits 0 with no TypeScript errors.
- `npm test --workspace=server` exits 0 with zero tests and zero failures.
- `npm run dev --workspace=client` starts the Vite dev server without errors.

---

### P1-T02 · Data Contracts

**Status:** ✅ Complete
**Complexity:** low
**What:** Define all shared TypeScript interfaces in a single file
  (`server/src/types/index.ts`). This file is the source of truth for every stage's
  input and output shape. It contains no implementation logic.
**Prerequisite:** P1-T01 complete.
**Hard deps:** P1-T01
**Files:** `server/src/types/index.ts` (new)
**Reviewer:** Skip
**Key constraints:**

- This file must export exactly these named exports and no others: `JobStrength`,
  `StageNumber`, `RunStatus`, `RawJob`, `FilteredJob`, `ExtractedRequirements`,
  `ExtractedJob`, `GatedJob`, `ScoredJob`, `RejectedJob`, `StageResult`, `StageReport`,
  `ReportCard`, `PipelineRunOutput`.
- No other file in the project may redefine these types — all stage and route files
  must import from this file.
- No implementation logic, utility functions, or constants belong in this file.

**Done when:**

- `server/src/types/index.ts` exports all 15 named types listed above.
- `npm run build --workspace=server` exits 0 with the types file present.
- A downstream file that imports a missing type produces a compile error (confirms
  the exports are real, not `any`-typed stubs).

---

### P1-T03 · Config Loaders

**Status:** ✅ Complete
**Complexity:** medium
**What:** Two pure loader functions — `loadCompanyConfig(token)` and
  `loadSkillsProfile()` — each with full validation and typed return values. These are
  the only functions in the codebase that read config files from disk. A named
  `ConfigValidationError` class is exported alongside the loaders.
**Prerequisite:** P1-T02 complete.
**Hard deps:** P1-T02
**Files:** `server/src/config/types.ts` (new), `server/src/config/companyConfig.ts` (new),
  `server/src/config/skillsProfile.ts` (new), `server/src/config/companyConfig.test.ts` (new),
  `server/src/config/skillsProfile.test.ts` (new),
  `server/__fixtures__/config/figma.json` (new),
  `server/__fixtures__/config/adam.json` (new)
**Reviewer:** Skip
**Key constraints:**

- `loadCompanyConfig` reads from `config/companies/{token}.json`.
- `loadSkillsProfile` reads from `profile/adam.json`.
- Both functions throw `ConfigValidationError` (named class, not a generic `Error`) on
  missing file, missing required field, wrong type, empty arrays, or out-of-range values.
- `gapThreshold` must be validated as a number in the range 0–1 (exclusive of both ends).
- Stage modules must never call these loaders directly — they receive pre-validated config
  objects as function arguments.

**Done when:**

- `npm test --workspace=server -- --testPathPattern=config` exits 0.
- Test suite covers: valid load, missing file, missing required field, empty departments
  array, missing sectionHeaders, empty skills array, missing gapThreshold, and
  out-of-range threshold (10 named test cases across both test files).

---

### P1-T04 · Greenhouse Fixture

**Status:** ✅ Complete
**Complexity:** low
**What:** Manually fetch and save a real Greenhouse API response for Figma to disk.
  This is the foundation for all Stage 1–4 tests. This task contains no code to write.
**Prerequisite:** P1-T03 complete.
**Hard deps:** P1-T03
**Files:** `server/__fixtures__/figma-api-response.json` (new)
**Reviewer:** Skip
**Key constraints:**

- This is a manual task. No code is written. Run the PowerShell command and save the
  output: `$r = Invoke-RestMethod "https://boards-api.greenhouse.io/v1/boards/figma/jobs?content=true"; $r | ConvertTo-Json -Depth 10 | Out-File server/__fixtures__/figma-api-response.json`
- No test beyond P1-T03 may call the live Greenhouse API. The fixture is the only
  source of Greenhouse data for all downstream tests.

**Done when:**

- `server/__fixtures__/figma-api-response.json` exists and is valid JSON.
- The file contains a `jobs` array with 20 or more entries.
- At least one job has a non-empty `content` field containing
  `<div class="content-conclusion">`.
- At least one job has the text `"We'd love to hear from you if you have:"` in its
  `content` field.

---

### Dependency graph

```
P1-T01
  └── P1-T02
        └── P1-T03
              └── P1-T04
```

---

# Phase 2 — Pipeline Stages

**Status:** ✅ Complete

Build the five pipeline stage modules and supporting infrastructure (DeepSeek client,
output persistence). Each module has a single concern, a typed function contract, and
independent test coverage. No stage module imports from another stage module.

---

## Phase 2 tasks

### P2-T01 · Stage 1 — Fetch

**Status:** ✅ Complete
**Complexity:** low
**What:** A single exported async function `fetchJobs(token)` that fetches the
  Greenhouse job catalog for a given token and returns `{ jobs: RawJob[], rawCount: number }`.
  A named `FetchError` class is exported alongside the function. All Greenhouse HTTP logic
  is isolated here.
**Prerequisite:** P1-T04 complete.
**Hard deps:** P1-T04
**Files:** `server/src/pipeline/stage1-fetch.ts` (new),
  `server/src/pipeline/stage1-fetch.test.ts` (new)
**Reviewer:** Skip
**Key constraints:**

- No test in this file may make a live HTTP request to the Greenhouse API. All tests
  mock the HTTP layer.
- Throws `FetchError` (not a generic Error) on non-200 status, invalid JSON, missing
  `jobs` array, or empty `jobs` array.

**Done when:**

- `npm test --workspace=server -- --testPathPattern=stage1` exits 0.
- Test suite covers: valid response, HTTP non-200, invalid JSON body, missing jobs
  array, empty jobs array, and rawCount equals jobs.length (6 named test cases).

---

### P2-T02 · Stage 2 — Metadata Filter

**Status:** ✅ Complete
**Complexity:** medium
**What:** A pure exported function `filterJobs(jobs, config)` that applies three
  sequential filters (location, department, role-name keyword) and returns
  `StageResult<FilteredJob>`. A named `ConfigMismatchError` is thrown when zero jobs
  survive all three filters.
**Prerequisite:** P2-T01 complete.
**Hard deps:** P2-T01
**Files:** `server/src/pipeline/stage2-filter.ts` (new),
  `server/src/pipeline/stage2-filter.test.ts` (new)
**Reviewer:** Skip
**Key constraints:**

- This function must be pure: no I/O, no network, no side effects.
- Location matching is case-insensitive substring (e.g. "Remote" matches "Remote (US)").
- Department matching is case-insensitive exact match.
- Role-name keyword matching is case-insensitive substring on job title.
- Each rejected job must carry a `reason` string naming the filter that rejected it and
  the value that failed.
- Throws `ConfigMismatchError` (named class) when `passed.length === 0`.

**Done when:**

- `npm test --workspace=server -- --testPathPattern=stage2` exits 0.
- Test suite covers: location retained, location excluded, department retained,
  department excluded, keyword retained, keyword excluded, case-insensitive location,
  case-insensitive department, case-insensitive keyword, zero-survivors throws
  ConfigMismatchError, all rejected jobs have `rejectedAtStage: 2`, and first failing
  filter is the one reported (12 named test cases).

---

### P2-T03 · Stage 3a — Normalizer

**Status:** ✅ Complete
**Complexity:** medium
**What:** A pure exported function `normalizeJobHtml(rawHtml)` that decodes HTML
  entities, repairs mojibake, strips boilerplate from `content-conclusion` onward,
  converts structural tags to Markdown, and returns `{ markdown, truncated }`. This
  function is the sole owner of HTML-to-Markdown conversion in the codebase.
**Prerequisite:** P2-T02 complete.
**Hard deps:** P2-T02
**Files:** `server/src/pipeline/normalizer.ts` (new),
  `server/src/pipeline/normalizer.test.ts` (new)
**Reviewer:** Skip
**Key constraints:**

- This function must be pure: no I/O, no LLM calls, no network.
- Processing order is fixed: (1) HTML entity decode, (2) mojibake repair, (3) truncate
  at `content-conclusion`, (4) strip remaining tags, (5) convert h4/li, (6) collapse
  blank lines, (7) trim.
- Use the `he` library for entity decoding. Use an explicit character map for confirmed
  mojibake patterns (`â` artifacts from UTF-8/Latin-1 corruption).
- `content-intro` div must be retained — only `content-conclusion` and everything after
  it is stripped.
- Throws `NormalizationError` (named class) if the result is empty after processing.

**Done when:**

- `npm test --workspace=server -- --testPathPattern=normalizer` exits 0.
- Test suite covers: entity decode, mojibake apostrophe (`Figmaâs` → `Figma's`),
  mojibake contraction (`wonât` → `won't`), content-conclusion stripped with
  `truncated: true`, content-intro retained, no content-conclusion sets `truncated: false`,
  `<h4>` → `###`, `<li>` → `*`, tags stripped, empty result throws NormalizationError,
  and real Figma fixture round-trip (no HTML tags in output, EEO boilerplate absent,
  intro text present) — 12 named test cases.

---

### P2-T04 · DeepSeek Client

**Status:** ✅ Complete
**Complexity:** high
**What:** Three modules that collectively own all LLM interaction: `deepseekClient.ts`
  (API client with internal rate limiter), `schemaValidator.ts` (validates LLM JSON
  output against expected shapes), and `costEstimator.ts` (token-count to USD conversion).
  No stage module calls DeepSeek directly — all LLM calls go through this module.
**Prerequisite:** P2-T03 complete.
**Hard deps:** P2-T03
**Files:** `server/src/llm/deepseekClient.ts` (new),
  `server/src/llm/schemaValidator.ts` (new), `server/src/llm/costEstimator.ts` (new),
  `server/src/llm/deepseekClient.test.ts` (new),
  `server/src/llm/schemaValidator.test.ts` (new)
**Reviewer:** Gemini
**Key constraints:**

- Use the `openai` npm package with `baseURL: "https://api.deepseek.com"` and
  `model: "deepseek-chat"`. Do not use any other DeepSeek SDK.
- The internal rate limiter must enforce a minimum 1500ms delay between consecutive
  calls. It is stateful within the module instance.
- Throws `LlmApiError` (named class) on API failure; throws `LlmSchemaError` (named
  class, with field-level detail) on schema validation failure.
- No test may make a live DeepSeek API call — mock the OpenAI client.
- The DEEPSEEK_API_KEY must be read from `process.env` only — never hardcoded.
- `deepseekClient.ts` must never log the full response content, only token counts.

**Done when:**

- `npm test --workspace=server -- --testPathPattern=llm` exits 0.
- Schema validator tests cover: valid extraction schema, missing `must_haves`, wrong
  type for `years_experience_required`, null `years_experience_required`, valid score
  schema, score out of range (>10), empty `scoreReasoning` (7 named test cases).
- Client tests cover: valid response returns LlmResponse, API failure throws LlmApiError,
  schema violation throws LlmSchemaError, rate limiter enforces ≥1500ms delay between
  calls (4 named test cases).

---

### P2-T05 · Stage 3b — Extractor

**Status:** ✅ Complete
**Complexity:** high
**What:** An exported async function `extractJobs(jobs, config, companyName)` that
  runs the normalizer on each FilteredJob, attempts heuristic extraction using
  `config.sectionHeaders`, falls back to DeepSeek on header miss, and returns
  `Stage3Result` (passed ExtractedJobs, rejected RejectedJobs, and ExtractionStats
  tracking heuristic hits vs LLM fallbacks).
**Prerequisite:** P2-T04 complete.
**Hard deps:** P2-T04
**Files:** `server/src/pipeline/stage3-extractor.ts` (new),
  `server/src/pipeline/stage3-extractor.test.ts` (new)
**Reviewer:** Gemini
**Key constraints:**

- This stage module must not import from any other stage module (`stage1-fetch.ts`,
  `stage2-filter.ts`). It imports only from `normalizer.ts` and `llm/deepseekClient.ts`.
- When the heuristic succeeds, `callDeepSeek` must not be called — confirm with a spy
  in the test.
- On `NormalizationError`, `LlmSchemaError`, or `LlmApiError`: add job to rejected
  with the error message as reason and continue processing remaining jobs.
- `ExtractionStats` must track `heuristicHits`, `llmFallbacks`, `llmTokensUsed`, and
  `estimatedCostUsd`.

**Done when:**

- `npm test --workspace=server -- --testPathPattern=stage3-extractor` exits 0.
- Test suite covers: heuristic hit extracts must-haves, heuristic hit does NOT call
  DeepSeek, heuristic miss triggers DeepSeek, valid LLM schema passes, LLM schema
  error rejects job, LLM API error rejects job, normalization error rejects job, stats
  count correctly, extracted job inherits URL from FilteredJob, both sections extracted
  when both headers present, null years-experience when absent (11 named test cases).

---

### P2-T06 · Stage 4 — Gap Filter

**Status:** ✅ Complete
**Complexity:** medium
**What:** Three exported pure functions: `matchSkill(requirement, profile)` (core
  matching logic, independently testable), `computeGapRatio(mustHaves, profile)`, and
  `filterByGap(jobs, profile)` which returns `StageResult<GatedJob>`. Jobs with
  `gapRatio >= profile.gapThreshold` are rejected.
**Prerequisite:** P2-T05 complete.
**Hard deps:** P2-T05
**Files:** `server/src/pipeline/stage4-gap-filter.ts` (new),
  `server/src/pipeline/stage4-gap-filter.test.ts` (new)
**Reviewer:** Skip
**Key constraints:**

- This function must be pure: no I/O, no LLM calls, no network.
- `matchSkill` uses case-insensitive substring matching on both skill `name` and all
  `aliases`. Strength level is irrelevant — any strength is a full match.
- A job with zero must-haves must always pass (gapRatio = 0).
- A job at exactly the threshold (gapRatio === gapThreshold) must be rejected.
- Rejection reason must name the specific unmatched must-have skills.

**Done when:**

- `npm test --workspace=server -- --testPathPattern=stage4` exits 0.
- `matchSkill` tests cover: exact name match, alias match, partial substring match,
  case-insensitive name, case-insensitive alias, low-strength counts as match, no match
  returns false (7 named test cases).
- `computeGapRatio` tests cover: all matched, half matched, none matched, empty
  must-haves returns ratio 0 (4 named test cases).
- `filterByGap` tests cover: below threshold passes, at threshold rejected, above
  threshold rejected, rejection reason names unmatched skills, GatedJob contains correct
  matched/unmatched arrays (5 named test cases — 16 total across the suite).

---

### P2-T07 · Stage 5 — Scorer

**Status:** ✅ Complete
**Complexity:** medium
**What:** An exported async function `scoreJobs(jobs, profile)` that sends each
  GatedJob to DeepSeek with a structured prompt requesting a 1–10 score and one sentence
  of reasoning. Returns `Stage5Result` with `scoredJobs` sorted descending by score,
  any `rejected` jobs that failed LLM validation, and `ScoringStats`. The prompt
  template is owned here and nowhere else.
**Prerequisite:** P2-T06 complete.
**Hard deps:** P2-T06
**Files:** `server/src/pipeline/stage5-scorer.ts` (new),
  `server/src/pipeline/stage5-scorer.test.ts` (new)
**Reviewer:** Skip
**Key constraints:**

- No test may make a live DeepSeek API call — mock `deepseekClient`.
- On `LlmSchemaError` or `LlmApiError` for a single job: add to rejected and continue
  processing remaining jobs.
- Score must be validated as a number in range 1–10. `scoreReasoning` must be a
  non-empty string. Both enforced by `schemaValidator` before accepting the response.
- Sorted jobs are sorted by score descending before returning.

**Done when:**

- `npm test --workspace=server -- --testPathPattern=stage5` exits 0.
- Test suite covers: valid score produces ScoredJob, score out of range rejects job,
  missing reasoning rejects job, API error on one job continues others, results sorted
  descending, stats reflect total call count (6 named test cases).

---

### P2-T08 · Dedup Cache and Persistence

**Status:** ✅ Complete
**Complexity:** low
**What:** Two modules: `dedupCache.ts` (`isProcessed(jobId)` and `markProcessed(jobId)`)
  reading/writing `output/processed_ids.json`, and `runPersister.ts`
  (`persistRun(data)` writing `output/{company}-{YYYY-MM-DD}.json`). These are the
  only modules that write to the `output/` directory.
**Prerequisite:** P2-T07 complete.
**Hard deps:** P2-T07
**Files:** `server/src/output/dedupCache.ts` (new),
  `server/src/output/runPersister.ts` (new),
  `server/src/output/dedupCache.test.ts` (new),
  `server/src/output/runPersister.test.ts` (new)
**Reviewer:** Skip
**Key constraints:**

- Tests must use temporary directories — never write to the real `output/` directory
  during a test run.
- `isProcessed` must return `false` (not throw) when `processed_ids.json` does not exist.
- `markProcessed` must be idempotent — calling it twice with the same ID must not
  create duplicate entries.
- `persistRun` throws `PersistenceError` (named class) if the write fails.

**Done when:**

- `npm test --workspace=server -- --testPathPattern=output` exits 0.
- Dedup cache tests cover: absent file returns false, unprocessed ID returns false,
  processed ID returns true, mark-then-check, mark-idempotent (5 named test cases).
- Persister tests cover: correct filename format, file is valid JSON matching RunOutput
  shape, returns filepath, write failure throws PersistenceError (4 named test cases).

---

### Dependency graph

```
P1-T04
  └── P2-T01
        └── P2-T02
              └── P2-T03
                    └── P2-T04
                          └── P2-T05
                                └── P2-T06
                                      └── P2-T07
                                            └── P2-T08
```

---

# Phase 3 — Server

**Status:** ✅ Complete

Wire the pipeline stages into a single orchestrated run via an event-emitting
orchestrator function, then expose that orchestrator through an Express server with
SSE streaming and config read/write routes. No business logic belongs in the server
layer.

---

## Phase 3 tasks

### P3-T01 · Pipeline Orchestrator

**Status:** ✅ Complete
**Complexity:** high
**What:** A single exported async function `runPipeline(companyToken, emit)` that
  calls all five stages in sequence, runs the dedup cache check between Stage 2 and
  Stage 3, emits `PipelineEvent` objects at each stage boundary and per job, persists
  the run on completion, and marks all scored jobs as processed.
**Prerequisite:** P2-T08 complete.
**Hard deps:** P2-T08
**Files:** `server/src/pipeline/orchestrator.ts` (new),
  `server/src/pipeline/orchestrator.test.ts` (new)
**Reviewer:** Gemini
**Key constraints:**

- The orchestrator must not contain business logic — it calls stage functions and relays
  their output as events via the `emit` callback.
- All stage functions must be mocked in orchestrator tests — no real stage logic runs.
- Emits `stage-start` and `stage-complete` events for each of the five stages.
- Emits `job-passed` and `job-rejected` events per job as they move through each stage.
- On `ConfigMismatchError` from Stage 2: emits `run-error` event and rethrows.
- Dedup cache check occurs after Stage 2 and before Stage 3 — deduplicated jobs emit
  as `job-rejected` with `rejectedAtStage: 3` and reason `"Already processed"`.
- `runPersister.persistRun` must be called exactly once on successful completion.

**Done when:**

- `npm test --workspace=server -- --testPathPattern=orchestrator` exits 0.
- Test suite covers: stages called in order 1→2→3→4→5, dedup skips processed jobs,
  stage-start and stage-complete emitted per stage, job-passed events emitted, job-rejected
  events emitted, run-complete emits ReportCard, ConfigMismatchError emits run-error,
  persistRun called on completion (8 named test cases).

---

### P3-T02 · Express Server and SSE Routes

**Status:** ✅ Complete
**Complexity:** medium
**What:** The Express application with three route groups: the SSE pipeline endpoint
  (`POST /api/run/:token`), config read/write routes (`GET/PUT /api/config/company/:token`,
  `GET/PUT /api/config/profile`, `GET /api/companies`), and static serving of the React
  build in production.
**Prerequisite:** P3-T01 complete.
**Hard deps:** P3-T01
**Files:** `server/src/server.ts` (new), `server/src/routes/pipeline.ts` (new),
  `server/src/routes/config.ts` (new)
**Reviewer:** Skip
**Key constraints:**

- No business logic in route files. Routes call `runPipeline` or config loaders and
  relay results — nothing else.
- SSE endpoint must set headers `Content-Type: text/event-stream`,
  `Cache-Control: no-cache`, `Connection: keep-alive` before streaming.
- Each `PipelineEvent` is serialized as `data: {JSON}\n\n`.
- Config PUT routes must validate the incoming JSON via the config loader before
  writing to disk. Return `400` with `{ error, detail }` on validation failure.
- `DEEPSEEK_API_KEY` must never appear in any route response or log output.

**Done when:**

- `npm run build --workspace=server` exits 0.
- Manual smoke test: `curl http://localhost:3001/api/companies` returns a JSON array
  containing `"figma"`.
- Manual smoke test: `curl -N -X POST http://localhost:3001/api/run/figma` streams
  SSE `data:` events visible in the terminal.

---

### Dependency graph

```
P2-T08
  └── P3-T01
        └── P3-T02
```

---

# Phase 4 — React UI

**Status:** Pending

Build the browser interface on top of the fully-tested server. Each component has a
single concern. The `usePipelineStream` hook owns all SSE logic — no component
connects to `EventSource` directly.

---

## Phase 4 tasks

### P4-T01 · Vite Scaffold and SSE Hook

**Status:** ✅ Complete
**Complexity:** medium
**What:** Configure the Vite/React workspace for real use and build the core
  `usePipelineStream(token)` hook that owns all SSE connection logic, accumulates
  `PipelineEvent` objects into state, and exposes `start()` and `reset()` controls.
**Prerequisite:** P3-T02 complete.
**Hard deps:** P3-T02
**Files:** `client/src/hooks/usePipelineStream.ts` (new),
  `client/src/types/events.ts` (new), `client/src/App.tsx`
**Reviewer:** Skip
**Key constraints:**

- No component may connect to `EventSource` directly — all SSE interaction goes through
  `usePipelineStream`.
- The hook must close the `EventSource` connection on `reset()` and on component unmount.
- `client/src/types/events.ts` mirrors the `PipelineEvent` types from the server. Types
  are not imported from the server workspace — they are duplicated and kept in sync
  manually.

**Done when:**

- `npm run dev --workspace=client` starts without console errors.
- Manually confirmed: calling `start()` from the hook opens an EventSource to
  `/api/run/figma` and populates `state.events` with received events (visible in
  React DevTools or browser console).

---

### P4-T02 · Company Selector and Run Controls

**Status:** ✅ Complete
**Complexity:** low
**What:** A `CompanySelector` component that fetches available tokens from
  `GET /api/companies` and renders a `<select>`, and a `RunControls` component with
  Run/Reset buttons that are disabled at appropriate states.
**Prerequisite:** P4-T01 complete.
**Hard deps:** P4-T01
**Files:** `client/src/components/CompanySelector.tsx` (new),
  `client/src/components/RunControls.tsx` (new), `client/src/App.tsx`
**Reviewer:** Skip
**Key constraints:**

- Run button must be disabled when `token` is null or `status` is `"running"`.
- Reset button must close the active SSE stream via `usePipelineStream`'s `reset()`.

**Done when:**

- Selecting a company from the dropdown and pressing Run triggers an SSE connection
  visible as a `text/event-stream` response in the browser Network tab.
- Run button is visibly disabled while the pipeline is running.

---

### P4-T03 · Live Stage Panels

**Status:** ✅ Complete
**Complexity:** medium
**What:** A `StagePanel` component (one instance per stage, rendered as the pipeline
  runs) showing the stage's filter config, jobs that passed (green), and jobs that
  were rejected (red with reason). A `JobRow` sub-component renders each job with a
  clickable title link.
**Prerequisite:** P4-T02 complete.
**Hard deps:** P4-T02
**Files:** `client/src/components/StagePanel.tsx` (new),
  `client/src/components/JobRow.tsx` (new), `client/src/App.tsx`
**Reviewer:** Skip
**Key constraints:**

- All job titles must be anchor tags with `target="_blank"` linking to the job's URL.
- Stage panels update in real time as `job-passed` and `job-rejected` SSE events arrive
  — panels must not wait for `stage-complete` before rendering jobs.

**Done when:**

- Running a Figma pipeline shows all five stage panels updating live with no console
  errors.
- At least one job is visible in a passed list and at least one in a rejected list.
- All job title links open the correct Greenhouse job URL in a new tab.

---

### P4-T04 · Report Card and Scored Jobs View

**Status:** ✅ Complete
**Complexity:** low
**What:** A `ReportCard` component rendered on `run-complete` showing per-stage
  pass/fail counts, heuristic/LLM ratio, estimated cost, and runtime; and a
  `ScoredJobsList` component showing matched jobs sorted descending by score with
  score badge, reasoning sentence, and matched/unmatched must-have lists.
**Prerequisite:** P4-T03 complete.
**Hard deps:** P4-T03
**Files:** `client/src/components/ReportCard.tsx` (new),
  `client/src/components/ScoredJobsList.tsx` (new), `client/src/App.tsx`
**Reviewer:** Skip
**Done when:**

- Completing a Figma run renders a report card with per-stage counts and a cost figure.
- Scored jobs list renders with at least one job showing a numeric score (1–10), a
  one-sentence reasoning string, and the matched vs unmatched must-haves.
- Jobs are ordered with the highest score first.

---

### P4-T05 · Config Editor

**Status:** Pending
**Complexity:** medium
**What:** A `ConfigEditor` component that fetches both the company config and skills
  profile, renders them as editable fields, saves via PUT endpoints, shows server
  validation errors on 400, and warns the user of unsaved changes before allowing
  a new run.
**Prerequisite:** P4-T04 complete.
**Hard deps:** P4-T04
**Files:** `client/src/components/ConfigEditor.tsx` (new), `client/src/App.tsx`
**Reviewer:** Skip
**Key constraints:**

- The Run button in `RunControls` must be disabled while there are unsaved changes in
  the config editor. Pass an `hasUnsavedChanges` flag up to the parent via a callback.
- Server validation errors (400 responses) must be displayed inline — not silently
  swallowed.

**Done when:**

- Editing `targetDepartments` in the config editor, saving, and running the pipeline
  reflects the updated filter in the Stage 2 panel results.
- An invalid config change (e.g., empty `targetDepartments`) triggers a visible
  inline error from the server.
- A modified but unsaved config disables the Run button with a visible "Unsaved
  changes" indicator.

---

### Dependency graph

```
P3-T02
  └── P4-T01
        └── P4-T02
              └── P4-T03
                    └── P4-T04
                          └── P4-T05
```

