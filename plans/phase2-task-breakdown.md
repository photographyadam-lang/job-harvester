# Phase 2 — Bulk Company Search · Implementation Task Breakdown

**Generated:** 2026-06-30  
**Source spec:** [`plans/phase2-bulk-search-spec.md`](plans/phase2-bulk-search-spec.md)  
**Prerequisite:** Phase 4 React UI complete (P4-T04 at minimum)

---

## Preamble: What Phase 2 Accomplishes

Phase 2 adds a **bulk company search** capability to the job-harvester. The user selects multiple companies and a skills profile from a new `/all-companies` page, then watches the 5-stage pipeline run sequentially against each company via SSE streaming. Results are deduplicated by URL (same job across companies collapsed, highest score kept), persisted to `output/all-companies-{date}.json`, and displayed in either a merged score-sorted view or a per-company accordion breakdown with score-threshold filtering.

This requires:
- **Server:** A new `runBulkPipeline` orchestrator, a `POST /api/bulk-run` SSE route, a parameterised `loadSkillsProfile`, a `PipelineRunOptions` extension to `runPipeline`, a `bulkPersister` output module, and 17 new types in the shared types file.
- **Client:** 10 new React components, a new `useBulkPipelineStream` hook using `fetch()` + manual SSE parsing (not `EventSource`), and a refactored `App.tsx` with tab-based navigation.

---

## Task Dependency Graph (Text)

```
T00 (AGENTS.md Rule 18 update)
  └─> T07 (bulkPersister) [depends on T00 for rule compliance]

T01 (loadSkillsProfile param) ───────────────────────────┐
  └─> T02 (GET /api/profiles) [may use T01's function]   │
                                                          │
T03 (server types) ──────────────────────────────────────┼──┐
  ├─> T04 (client types mirror T03)                      │  │
  └─> T05 (runPipeline PipelineRunOptions) ──────────────┤  │
        └─> T06 (runBulkPipeline) ── depends on T01,T03,T05  │
              └─> T08 (POST /api/bulk-run route) ────────┘  │
                    └─> T09 (mount in server.ts)             │
                                                             │
T07 (bulkPersister) ── depends on T00, T03 ─────────────────┤
  └─> T08 also depends on T07                               │
                                                             │
T04 (client types) ─────────────────────────────────────────┘
  └─> T10 (useBulkPipelineStream hook)
        └─> T15 (BulkRunControls) ── interface ref only
        └─> T21 (AllCompaniesPage) ── depends on hook

T11 (TabBar) ────────────────────────── no server deps
T12 (SingleCompanyPage extraction) ──── no server deps

T13 (ProfileSelector) ─── references T02 API contract
T14 (CompanyCheckboxList) ── references existing GET /api/companies

T16 (BulkProgressBar) ─── no server deps
T17 (ViewModeToggle) ──── no server deps
T18 (ScoreThresholdSlider) ─ no server deps
T19 (BulkScoredJobsList) ─── depends on T04
T20 (CompanyAccordion) ───── depends on T04

T21 (AllCompaniesPage) ── depends on T10,T13-T20
T22 (App.tsx wiring) ──── depends on T11,T12,T21
```

All client component tasks (T11–T20) can be built in parallel with each other. Server-side tasks T01–T09 form a sequential chain (T06 is the bottleneck). Client components T11–T20 are independent of server completion — they only depend on type definitions (T03/T04) and API contracts (documented in the spec).

---

## Tasks

### T00: Update AGENTS.md Rule 18 for Bulk Output File

- **Dependencies:** None
- **Starting criteria:** `git branch --show-current` confirms `main`; P4-T04 complete
- **Implementation scope:**
  - Edit [`AGENTS.md`](AGENTS.md:57-58), Rule 18
  - Change from: `output/processed_ids.json` and `output/{company}-{date}.json` are the only files written to the `output/` directory.
  - Change to: `output/processed_ids.json`, `output/{company}-{date}.json`, and `output/all-companies-{date}.json` are the only files written to the `output/` directory. No other module may write to `output/`.
  - Single-file, single-line change. No tests needed (rules doc change).
- **Testing criteria:** Manual review confirms the updated text. No test file changes.
- **Completion criteria:** AGENTS.md Rule 18 lists all three output file patterns.

---

### T01: Parameterise `loadSkillsProfile(profileName?)`

- **Dependencies:** None
- **Starting criteria:** `npm test --workspace=server` passes clean
- **Implementation scope:**
  - Modify [`server/src/config/skillsProfile.ts`](server/src/config/skillsProfile.ts:20): change signature to `loadSkillsProfile(profileName?: string): SkillsProfile`
  - Add `const name = profileName ?? 'adam';` at top of function body
  - Replace hardcoded `'adam'` in `path.resolve(process.cwd(), 'profile', 'adam.json')` with `` path.resolve(process.cwd(), 'profile', `${name}.json`) ``
  - No other logic changes. The `profileName` parameter defaults to `'adam'` when omitted, preserving backward compatibility for all existing callers (single-company orchestrator, step orchestrator, config routes).
  - Modify [`server/src/config/skillsProfile.test.ts`](server/src/config/skillsProfile.test.ts) — add test cases (test-first per Rule 14):
    1. `loadSkillsProfile('adam')` with explicit name succeeds and returns a valid SkillsProfile
    2. `loadSkillsProfile('nonexistent')` throws ConfigValidationError
    3. `loadSkillsProfile()` (no argument) defaults to `'adam'` and returns same result as explicit `loadSkillsProfile('adam')`
    4. Existing tests continue to pass (backward compat)
- **Testing criteria:**
  - Test 1: Call `loadSkillsProfile('adam')` — returns SkillsProfile with non-empty skills array
  - Test 2: Call `loadSkillsProfile('nonexistent')` — throws `ConfigValidationError` with message containing the file path
  - Test 3: Call `loadSkillsProfile()` — returns the same SkillsProfile as `loadSkillsProfile('adam')`
  - Test 4: All existing skills profile tests pass unchanged
- **Completion criteria:** `npm test --workspace=server` passes clean; no regressions

---

### T02: Add `GET /api/profiles` Route

- **Dependencies:** T01 (uses the parameterised `loadSkillsProfile` function; can proceed in parallel if the API contract is known)
- **Starting criteria:** T01 complete; `npm test --workspace=server` passes clean
- **Implementation scope:**
  - Modify [`server/src/routes/config.ts`](server/src/routes/config.ts): add new route handler `GET /api/profiles` after the existing `GET /api/companies` handler (around line 79)
  - Implementation: scan `server/profile/` directory for `*.json` files, return array of filename stems (without `.json` extension)
  - Use `fs.readdirSync` (same pattern as `GET /api/companies`)
  - Return empty array `[]` if directory doesn't exist or contains no `.json` files; return `500` only for unexpected filesystem errors
  - No business logic — purely directory listing (Rule 12)
  - Modify [`server/src/routes/config.test.ts`](server/src/routes/config.test.ts) — add test cases:
    1. `GET /api/profiles` returns list of JSON stems from `profile/` directory (need test fixture: create a temp profile directory with known files)
    2. `GET /api/profiles` returns empty array when `profile/` directory doesn't exist or has no `.json` files
    3. Verify response content-type is `application/json`
- **Testing criteria:**
  - Test 1: Mock `fs.readdirSync` to return `['adam.json', 'jane.json', 'notes.txt']` — expect `['adam', 'jane']`
  - Test 2: Mock `fs.readdirSync` to throw `ENOENT` — expect `[]`
  - Test 3: Mock `fs.readdirSync` to return `[]` — expect `[]`
  - (Note: tests use mocked `fs`, not real filesystem)
- **Completion criteria:** `npm test --workspace=server` passes clean

---

### T03: Add Bulk Types to `server/src/types/index.ts`

- **Dependencies:** None (pure type definitions; no runtime code)
- **Starting criteria:** `npm test --workspace=server` passes clean. Verify that `server/src/config/types.ts` does NOT import from `../types` (no circular dependency). If it does, `PipelineRunOptions` must use type-only imports or `CompanyConfig`/`SkillsProfile` must be moved into `types/index.ts`.
- **Implementation scope:**
  - Edit [`server/src/types/index.ts`](server/src/types/index.ts) — append new type block at end of file (after line 335, before any closing comments)
  - Add the following types exactly as specified in §5.1 and §5.2 of the plan:
    1. `BulkRunRequest` — `{ companies: string[]; profile: string }`
    2. `BulkStartEvent` — `{ type: 'bulk_start'; companies: string[]; profile: string; totalCompanies: number }`
    3. `CompanyStartEvent` — `{ type: 'company_start'; companyToken: string; companyName: string; index: number; totalCompanies: number }`
    4. `CompanyCompleteEvent` — `{ type: 'company_complete'; companyToken: string; companyName: string; reportCard: ReportCard; scoredJobs: ScoredJobSummary[] }`
    5. `CompanyErrorEvent` — `{ type: 'company_error'; companyToken: string; companyName: string; error: string }`
    6. `DedupedJobSummary extends ScoredJobSummary` — adds `companies: string[]` and `companyScores: Record<string, number>`
    7. `CompanyErrorSummary` — `{ token: string; name: string; error: string }`
    8. `BulkCompleteEvent` — full shape as in §5.1
    9. `BulkPipelineEvent` — discriminated union of bulk events
    10. `AnyPipelineEvent` — `PipelineEvent | BulkPipelineEvent`
    11. `BulkEmitCallback` — `(event: AnyPipelineEvent) => void`
    12. `PipelineRunOptions` — `{ companyConfig?: CompanyConfig; skillsProfile?: SkillsProfile; skipPersist?: boolean }` (needs import from `../config/types`)
    13. `BulkRunOutput` — output file shape
    14. `CompanyRunResult` — successful company result
    15. `CompanyErrorResult` — failed company result
    16. `DedupedJobRecord` — persisted deduped job
    17. `BulkRunStats` — aggregate statistics
  - No implementation logic, no defaults, no runtime code — pure types only
  - All types must be exported
  - No test file changes (types-only change; compile verification via `npm test` suffices)
- **Testing criteria:** `npm test --workspace=server` compiles and passes clean (existing tests validate that new types don't break existing type structures)
- **Completion criteria:** `npm test --workspace=server` passes clean; `tsc` compiles with no errors. Note: type correctness is partially validated by compilation; full usage validation occurs in downstream tasks T05, T06, T08.

---

### T04: Mirror Bulk Types to `client/src/types/events.ts`

- **Dependencies:** T03 (mirrors the exact type shapes)
- **Starting criteria:** T03 complete; `npm test --workspace=server` passes clean
- **Implementation scope:**
  - Edit [`client/src/types/events.ts`](client/src/types/events.ts) — append new type block at end of file (after line 144)
  - Add client-side mirrors of the following server types (no server imports — these are intentionally duplicated per the file header convention):
    1. `BulkStartEvent`
    2. `CompanyStartEvent`
    3. `CompanyCompleteEvent` (references existing `ReportCard` and `ScoredJobSummary` already in this file)
    4. `CompanyErrorEvent`
    5. `DedupedJobSummary extends ScoredJobSummary`
    6. `BulkCompleteEvent` (uses inline `{ token: string; name: string; error: string }[]` for `failures`, not a separate named type)
    7. `BulkPipelineEvent` — discriminated union
    8. `AnyPipelineEvent` — `PipelineEvent | BulkPipelineEvent`
  - Types must match the server types exactly in field names and shapes
  - No test file changes (types-only; existing client tests must still compile)
- **Testing criteria:** `npm test --workspace=client` compiles and passes clean
- **Completion criteria:** Client TypeScript compilation passes with zero errors

---

### T05: Refactor `runPipeline` for `PipelineRunOptions`

- **Dependencies:** T03 (needs `PipelineRunOptions` and `BulkEmitCallback` types)
- **Starting criteria:** T03 complete; `npm test --workspace=server` passes clean
- **Implementation scope:**
  - Modify [`server/src/pipeline/orchestrator.ts`](server/src/pipeline/orchestrator.ts:365):
    1. Add `PipelineRunOptions` to imports from `../types`
    2. Change `runPipeline` signature to: `export async function runPipeline(companyToken: string, emit: EmitCallback, options?: PipelineRunOptions): Promise<PipelineRunOutput>`
    3. In the config-loading section (lines 372-378):
       - If `options?.companyConfig` is provided, use it; otherwise call `loadCompanyConfig(companyToken)`
       - If `options?.skillsProfile` is provided, use it; otherwise call `loadSkillsProfile()` (no args, defaults to `'adam'`)
    4. In the persist section (line 497):
       - If `options?.skipPersist === true`, skip the `persistRun(output)` call
       - `markProcessed()` loop (lines 477-479) must still execute regardless of `skipPersist`
    5. Add JSDoc to document the new `options` parameter
    6. All other logic unchanged — stages 1-5 execute identically
  - Modify [`server/src/pipeline/orchestrator.test.ts`](server/src/pipeline/orchestrator.test.ts) — add test cases (test-first per Rule 14):
    1. Pre-loaded `companyConfig`: pass a valid CompanyConfig in options; verify `loadCompanyConfig` is NOT called; verify `resolveBoardToken` IS called with the provided config
    2. Pre-loaded `skillsProfile`: pass a valid SkillsProfile in options; verify `loadSkillsProfile` is NOT called
    3. `skipPersist: true`: verify `persistRun` is NOT called; verify `markProcessed` IS called for each scored job
    4. Partial options — only `companyConfig` provided: verify `loadSkillsProfile()` IS still called
    5. Partial options — only `skillsProfile` provided: verify `loadCompanyConfig()` IS still called
    6. No options (backward compat): verify behaviour identical to current — both `loadCompanyConfig` and `loadSkillsProfile` called, `persistRun` called
  - Tests must mock: `loadCompanyConfig`, `loadSkillsProfile`, `persistRun`, `markProcessed`, `fetchJobs`, `callDeepSeek` (or mock the entire stage functions)
  - All 6 new test cases must fail before implementation (Rule 14)
- **Testing criteria:**
  - Test 1: `runPipeline('figma', emit, { companyConfig: mockConfig })` — mockConfig used directly, `loadCompanyConfig` not called
  - Test 2: `runPipeline('figma', emit, { skillsProfile: mockProfile })` — mockProfile used directly, `loadSkillsProfile` not called
  - Test 3: `runPipeline('figma', emit, { skipPersist: true })` — `persistRun` not called, `markProcessed` called per job
  - Test 4: `runPipeline('figma', emit, { companyConfig: mockConfig })` — `loadSkillsProfile()` still called
  - Test 5: `runPipeline('figma', emit, { skillsProfile: mockProfile })` — `loadCompanyConfig()` still called
  - Test 6: `runPipeline('figma', emit)` — both loaders called, `persistRun` called
- **Completion criteria:** `npm test --workspace=server` passes clean; all 6 new tests pass; no regressions in existing tests

---

### T06: Implement `runBulkPipeline` in `bulkOrchestrator.ts`

- **Dependencies:** T01, T03, T05 (needs parameterised `loadSkillsProfile`, all bulk types, and `runPipeline` with `PipelineRunOptions`)
- **Starting criteria:** T01, T03, T05 complete; `npm test --workspace=server` passes clean
- **Implementation scope:**
  - Create [`server/src/pipeline/bulkOrchestrator.ts`](server/src/pipeline/bulkOrchestrator.ts) (new file)
  - Implement `runBulkPipeline(companies: string[], profileName: string, emit: BulkEmitCallback): Promise<BulkRunOutput>`:
    1. Deduplicate the input companies array: `const uniqueCompanies = [...new Set(companies)];` and iterate over `uniqueCompanies` for the remainder of the function.
    2. Load skills profile once: `const skillsProfile = loadSkillsProfile(profileName);`
    3. Emit `bulk_start` event (first event before any company processing)
    4. Initialise accumulators: `companyResults: Map<string, ScoredJob[]>`, `failures: CompanyErrorSummary[]`, timing
    5. For each company in `uniqueCompanies` (sequential loop):
       a. Emit `company_start` event
       b. Load company config via `loadCompanyConfig(token)` (wrapped in try/catch — if config loading fails, emit `company_error` and continue to next company)
       c. Call `runPipeline(token, emit, { companyConfig, skillsProfile, skipPersist: true })` (wrapped in try/catch)
       d. On success: store scored jobs in `companyResults`, emit `company_complete`
       e. On failure: store error in `failures`, emit `company_error`, continue to next company
    6. After all companies: run URL deduplication (function `deduplicateByUrl` — see §7.3 of spec)
    7. Persist aggregate output via `persistBulkRun()` (imported from `../output/bulkPersister`)
    8. Compute aggregate stats
    9. Emit `bulk_complete` with dedup'd results, stats, and failures
    10. Return `BulkRunOutput`
  - Deduplication function (module-private):
    - Key: absolute URL, normalized via `toLowerCase()` + trailing-slash stripping
    - Keep highest-scored instance per URL; tie-break by first encountered (deterministic)
    - Skip jobs with empty URL (log warning)
    - Collect all company tokens and per-company scores
    - Sort result by score descending
    - Note: case-insensitive (test 6) and trailing-slash (test 7) dedup tests cover orthogonal normalisation concerns; they compose correctly.
    - Note: `bulk_complete` uses `failures` (plural) consistently for the error list field.
  - Imports: `runPipeline` from `./orchestrator`, `loadCompanyConfig` from `../config/companyConfig`, `loadSkillsProfile` from `../config/skillsProfile`, `persistBulkRun` from `../output/bulkPersister`, all types from `../types`
  - Create [`server/src/pipeline/bulkOrchestrator.test.ts`](server/src/pipeline/bulkOrchestrator.test.ts) (new file) — test cases (test-first per Rule 14):
    1. `bulk_start` is the first event emitted, before any `company_start`
    2. Duplicate company tokens in input array are collapsed to unique before execution (e.g. `['figma', 'figma', 'databricks']` → figma runs once)
    3. Sequential execution: companies run in the order specified in the input array
    4. Company failure skip-and-continue: failed company emits `company_error`, remaining companies still run
    5. Dedup by URL: same URL across companies → one `DedupedJobSummary`, highest score kept, all companies tagged in `companies` array
    6. Dedup edge: case-insensitive URL matching
    7. Dedup edge: trailing-slash normalisation
    8. Dedup edge: same score tie-breaking (first instance wins, deterministic)
    9. Dedup edge: empty/missing URL → job skipped + warning logged
    10. Empty results from a company: `company_complete` emitted with `scoredJobs: []`
    11. All-companies-fail scenario: `bulk_complete` emitted with `successCount: 0`, `scoredJobs: []`, `failures` populated
    12. `bulk_complete` includes `aggregateHeuristicHits` and `aggregateLlmFallbacks` (sum across successful companies)
    13. `bulk_complete` `failures` array matches the companies that failed
  - Tests must mock: `runPipeline` (per-company), `loadCompanyConfig`, `loadSkillsProfile`, `persistBulkRun`; must NOT call real Greenhouse or DeepSeek APIs (Rule 8)
- **Testing criteria:** All 13 named test cases pass
- **Completion criteria:** `npm test --workspace=server` passes clean; all bulk orchestrator tests pass

---

### T07: Implement `persistBulkRun` in `bulkPersister.ts`

- **Dependencies:** T00 (Rule 18 must be updated first), T03 (needs `BulkRunOutput` type)
- **Starting criteria:** T00, T03 complete; `npm test --workspace=server` passes clean
- **Implementation scope:**
  - Create [`server/src/output/bulkPersister.ts`](server/src/output/bulkPersister.ts) (new file)
  - Implement `persistBulkRun(output: BulkRunOutput): void`:
    1. Compute filename: `all-companies-{YYYY-MM-DD}.json` using current date at call time
    2. Resolve full path: `path.resolve(process.cwd(), 'output', filename)`
    3. Create `output/` directory if it doesn't exist (using `fs.mkdirSync` with `{ recursive: true }`). Note: `fs.mkdirSync` with `{ recursive: true }` follows the existing `persistRun` pattern; acceptable for single-user throughput.
    4. Serialize `output` to JSON with 2-space indentation
    5. Write to file (overwrite if same-date file exists)
    6. Handle write errors: wrap in try/catch, log error, re-throw as a descriptive error
  - This is the ONLY module that writes to `output/all-companies-{date}.json` (Rule 18)
  - Create [`server/src/output/bulkPersister.test.ts`](server/src/output/bulkPersister.test.ts) (new file) — test cases:
    1. Writes correct `output/all-companies-{date}.json` with full `BulkRunOutput` schema
    2. Overwrites existing same-date file (call twice, verify second content wins)
    3. Creates `output/` directory if it doesn't exist
    4. Handles write errors gracefully (e.g., disk full / permissions) — does not crash
    5. Verifies JSON structure matches `BulkRunOutput` interface
  - Tests must use a temporary directory (via `fs.mkdtempSync` or `jest` mock), not the real `output/` directory
- **Testing criteria:** All 5 named test cases pass; no files written to real `output/` during tests
- **Completion criteria:** `npm test --workspace=server` passes clean

---

### T08: Implement `POST /api/bulk-run` SSE Route

- **Dependencies:** T06 (needs `runBulkPipeline`), T07 (needs `persistBulkRun`), T03 (needs types)
- **Starting criteria:** T06, T07 complete; `npm test --workspace=server` passes clean
- **Implementation scope:**
  - Create [`server/src/routes/bulk-run.ts`](server/src/routes/bulk-run.ts) (new file)
  - Implement Express router with `POST /api/bulk-run`:
    1. Validate request body (fail-fast with 400 JSON before opening SSE stream):
       - `companies` must be a non-empty array of strings
       - `profile` must be a non-empty string
    2. Pre-flight validation — load all company configs and the skills profile (explicitly sequential):
       2a. Load profile first via `loadSkillsProfile(profile)`; return 400 immediately if not found.
       2b. THEN load each company config via `loadCompanyConfig(token)`; return 400 with detail listing ALL missing tokens if any fail.
       - This ensures no partial runs (all-or-nothing validation)
    3. Set SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
    4. Create `emit` callback that writes SSE-formatted lines: `data: ${JSON.stringify(event)}\n\n`
    5. Handle client disconnect via `req.on('close', ...)` — set abort flag that `runBulkPipeline` can check between companies
    6. Call `runBulkPipeline(companies, profile, emit)`
    7. On `runBulkPipeline` rejection: emit `run-error` event (this should only happen if something unrecoverable fails outside the per-company try/catch)
    8. Close SSE connection on completion or error
  - No business logic — validates and delegates to `runBulkPipeline` (Rule 12)
  - Create [`server/src/routes/bulk-run.test.ts`](server/src/routes/bulk-run.test.ts) (new file) — test cases:
    1. Returns `400` with `{ error, detail }` when `companies` is missing
    2. Returns `400` when `companies` is an empty array
    3. Returns `400` when `profile` is missing
    4. Returns `400` when `profile` is not a string
    5. Returns `400` when profile file doesn't exist (pre-flight validation)
    6. Returns `400` when any company config is missing (pre-flight, with detail listing which)
    7. Sets SSE headers on valid request (`Content-Type: text/event-stream`, `Cache-Control: no-cache`)
    8. Emits `bulk_start` as first SSE event
    9. Handles single-company run through SSE
    10. Handles multi-company run through SSE
    11. Emits `company_error` and continues when a company's pipeline fails
    12. Emits `bulk_complete` with dedup'd results after all companies complete
    13. Handles client disconnect (SSE stream closes, no further events)
  - Tests must use `supertest` and mock `runBulkPipeline` (not call Greenhouse or DeepSeek — Rule 8). SSE events can be verified by collecting `data:` lines from the response.
- **Testing criteria:** All 13 named test cases pass
- **Completion criteria:** `npm test --workspace=server` passes clean

---

### T09: Mount Bulk-Run Routes in `server.ts`

- **Dependencies:** T08 (route module must exist)
- **Starting criteria:** T08 complete; `npm test --workspace=server` passes clean
- **Implementation scope:**
  - Edit [`server/src/server.ts`](server/src/server.ts):
    1. Add import: `import bulkRunRoutes from './routes/bulk-run';` (after line 28)
    2. Add mount: `app.use('/api', bulkRunRoutes);` (after line 48, alongside other route mounts)
  - No other changes to server.ts
  - Existing integration tests that use `createApp()` should continue to pass — the new routes are mounted but don't interfere with existing routes
- **Testing criteria:** `npm test --workspace=server` passes clean; `POST /api/bulk-run` responds (even if 400 due to missing body in integration test context)
- **Completion criteria:** `npm test --workspace=server` passes clean with zero regressions

---

### T10: Implement `useBulkPipelineStream` Hook

- **Dependencies:** T04 (needs `AnyPipelineEvent` and bulk event types from client types)
- **Starting criteria:** T04 complete; `npm test --workspace=client` passes clean
- **Implementation scope:**
  - Create [`client/src/hooks/useBulkPipelineStream.ts`](client/src/hooks/useBulkPipelineStream.ts) (new file)
  - Implement custom React hook with this API:
    ```typescript
    function useBulkPipelineStream(): {
      state: BulkPipelineState;
      start: (companies: string[], profile: string) => void;
      stop: () => void;
      reset: () => void;
    }
    ```
  - State shape: `BulkPipelineState` with fields: `status`, `error`, `events`, `companyStatuses` (Map-like object), `currentCompany`, `companiesCompleted`, `totalCompanies`, `incrementalResults`, `dedupedJobs`, `failures`, `stats`, `currentStageEvents`
  - `start()`: POSTs to `/api/bulk-run` via `fetch()` with JSON body; parses SSE from `response.body` `ReadableStream` using the pattern in Appendix C of the spec; uses `AbortController` for cancellation
  - `stop()`: calls `abortController.abort()`
  - `reset()`: calls `stop()` + clears all state
  - Event handling per §6.3 of spec:
    - `bulk_start` → set status running, store totalCompanies
    - `company_start` → set currentCompany, initialise stage events
    - `stage-start`/`job-passed`/`job-rejected`/`stage-complete` → append to currentStageEvents
    - `company_complete` → mark company success, store results, increment completed
    - `company_error` → mark company error, store error
    - `bulk_complete` → set dedupedJobs, failures, stats, status complete; abort reader
    - `fetch` rejection → set status error with connection-failed message
  - Create [`client/src/hooks/useBulkPipelineStream.test.ts`](client/src/hooks/useBulkPipelineStream.test.ts) (new file) — test cases:
    1. Processes `bulk_start` event: sets status='running', stores totalCompanies
    2. Processes `company_start` event: sets currentCompany
    3. Processes per-stage events (stage-start, job-passed, job-rejected, stage-complete)
    4. Processes `company_complete` event: stores results, increments completed count
    5. Processes `company_error` event: stores error for company, increments completed count
    6. Processes `bulk_complete` event: sets dedupedJobs, status='complete', aborts reader
    7. Handles `fetch` network failure: sets status='error' with message
    8. `stop()` aborts via AbortController and sets status='idle'
    9. `start()` resets state before beginning new stream
    10. SSE parsing from mock `ReadableStream`: multiple events in one chunk, partial chunks across reads, empty chunks
    11. Unmounting the component during a running stream calls `abortController.abort()` — use `renderHook`'s `unmount()` to verify the `AbortSignal` is triggered on cleanup
  - Note: Test 10 bundles multiple SSE parsing sub-concerns (multiple events in one chunk, partial chunks, empty chunks). If these prove too coupled during implementation, split into separate test cases.
  - Tests mock `fetch` globally (via `jest.spyOn` or similar) — must NOT make real HTTP requests (Rule 8)
  - The hook must NOT use `EventSource` — it uses `fetch()` + manual SSE parsing from `ReadableStream`
- **Testing criteria:** All 11 named test cases pass; hook correctly parses SSE `data:` lines from mock `ReadableStream`
- **Completion criteria:** `npm test --workspace=client` passes clean

---

### T11: Build `TabBar` Component

- **Dependencies:** None
- **Starting criteria:** `npm test --workspace=client` passes clean
- **Implementation scope:**
  - Create [`client/src/components/TabBar.tsx`](client/src/components/TabBar.tsx) (new file)
  - Props: `activeTab: 'single' | 'all'`, `onTabChange: (tab: 'single' | 'all') => void`, `disabled: boolean`
  - Two styled tab buttons; clicking calls `onTabChange` with the new tab value; clicks ignored when `disabled === true`
  - Visual: active tab highlighted; disabled state shows greyed-out cursor
  - Create [`client/src/components/TabBar.test.tsx`](client/src/components/TabBar.test.tsx) (new file) — test cases:
    1. Renders two tabs labeled "Single Company" and "All Companies"
    2. Clicking "All Companies" fires `onTabChange('all')`
    3. Clicking "Single Company" fires `onTabChange('single')`
    4. When `disabled=true`, clicking either tab does NOT fire `onTabChange`
    5. Active tab has distinct styling (e.g., aria-current or active class)
- **Testing criteria:** All 5 named test cases pass
- **Completion criteria:** `npm test --workspace=client` passes clean

---

### T12: Extract `SingleCompanyPage` from `App.tsx`

- **Dependencies:** None (refactoring existing code; no new behaviour)
- **Starting criteria:** `npm test --workspace=client` passes clean
- **Implementation scope:**
  - Create [`client/src/components/SingleCompanyPage.tsx`](client/src/components/SingleCompanyPage.tsx) (new file)
  - Move existing single-company UI from [`client/src/App.tsx`](client/src/App.tsx) into this component:
    - CompanySelector, ConfigEditor, RunControls, StagePanel×5, ReportCard, ScoredJobsList
    - All state and hook usage (`usePipelineStream`, etc.) moves with it
    - Props: none (component is self-contained with internal state, same as current App.tsx)
  - Modify [`client/src/App.tsx`](client/src/App.tsx) to import and render `<SingleCompanyPage />` where the current inline single-company JSX was
  - No behavioural changes — this is a pure extraction
  - Update existing [`client/src/App.test.tsx`](client/src/App.test.tsx) if needed to accommodate the component extraction (tests should still pass with minor import adjustments)
  - Create [`client/src/components/SingleCompanyPage.test.tsx`](client/src/components/SingleCompanyPage.test.tsx) (new file) with smoke tests: renders without crashing, passes children through, shows RunControls, shows StagePanel, shows ScoredJobsList
- **Testing criteria:**
  - `npm test --workspace=client` passes clean with no regressions; all existing App tests pass
  - New `SingleCompanyPage.test.tsx` passes with smoke tests
- **Completion criteria:** `npm test --workspace=client` passes clean; single-company pipeline works identically (manual smoke test optional, not required for completion per Rule 7)

---

### T13: Build `ProfileSelector` Component

- **Dependencies:** T02 (API contract for `GET /api/profiles` must be known)
- **Starting criteria:** T02 complete (or API contract clearly documented); `npm test --workspace=client` passes clean
- **Implementation scope:**
  - Create [`client/src/components/ProfileSelector.tsx`](client/src/components/ProfileSelector.tsx) (new file)
  - Props: `value: string | null`, `onChange: (profileName: string) => void`, `disabled?: boolean`
  - Fetches available profiles from `GET /api/profiles` on mount (using `useEffect` + `fetch`)
  - Renders a `<select>` dropdown with fetched profiles
  - Shows loading state while fetching; error state if fetch fails; empty state "No profiles available" if array is empty
  - Calls `onChange` when selection changes
  - Disabled when `disabled === true`
  - Create [`client/src/components/ProfileSelector.test.tsx`](client/src/components/ProfileSelector.test.tsx) (new file) — test cases:
    1. Renders dropdown populated from API response (mock `fetch` to return `['adam', 'jane']`)
    2. Fires `onChange` with selected profile name when user selects an option
    3. Shows loading state while API request is in-flight
    4. Shows error state when API request fails
    5. Shows "No profiles available" empty state when API returns `[]`
    6. Dropdown is disabled when `disabled=true`
  - Tests mock `fetch` globally — no real HTTP requests
- **Testing criteria:** All 6 named test cases pass
- **Completion criteria:** `npm test --workspace=client` passes clean

---

### T14: Build `CompanyCheckboxList` Component

- **Dependencies:** None (uses existing `GET /api/companies` which is already implemented)
- **Starting criteria:** `npm test --workspace=client` passes clean
- **Implementation scope:**
  - Create [`client/src/components/CompanyCheckboxList.tsx`](client/src/components/CompanyCheckboxList.tsx) (new file)
  - Props: `selected: Set<string>`, `onChange: (selected: Set<string>) => void`, `disabled?: boolean`
  - Fetches companies from `GET /api/companies` on mount
  - Renders checkboxes — one per company token with the token as label
  - "Select All" / "Deselect All" toggle button at top
  - "Select All" adds all tokens to the set; "Deselect All" creates an empty set
  - Individual checkbox toggles add/remove from set
  - Empty state when no companies: "No companies configured. Add a company first."
  - Create [`client/src/components/CompanyCheckboxList.test.tsx`](client/src/components/CompanyCheckboxList.test.tsx) (new file) — test cases:
    1. Renders checkboxes from API response (mock `fetch` to return `['figma', 'anthropic', 'databricks']`)
    2. "Select All" button selects all companies (calls `onChange` with full set)
    3. "Deselect All" button clears all selections (calls `onChange` with empty set)
    4. Individual checkbox toggle adds company to set
    5. Individual checkbox toggle removes company from set
    6. Shows empty state when API returns `[]`
    7. All checkboxes disabled when `disabled=true`
    8. Pre-selected companies are reflected in checked state (pass `selected` with pre-populated set)
  - Tests mock `fetch` globally
- **Testing criteria:** All 8 named test cases pass
- **Completion criteria:** `npm test --workspace=client` passes clean

---

### T15: Build `BulkRunControls` Component

- **Dependencies:** T10 (reference to hook status values, but no runtime dependency — just API contract)
- **Starting criteria:** `npm test --workspace=client` passes clean
- **Implementation scope:**
  - Create [`client/src/components/BulkRunControls.tsx`](client/src/components/BulkRunControls.tsx) (new file)
  - Props: `selectedCount: number`, `hasProfile: boolean`, `status: 'idle' | 'running' | 'complete' | 'error'`, `onRun: () => void`, `onStop: () => void`
  - Run button: enabled only when `status === 'idle'` AND `selectedCount > 0` AND `hasProfile === true`; shows tooltip explaining why disabled otherwise
  - Stop button: visible only when `status === 'running'`; calls `onStop`
  - Status indicator text showing current state
  - Create [`client/src/components/BulkRunControls.test.tsx`](client/src/components/BulkRunControls.test.tsx) (new file) — test cases:
    1. Run button disabled when `selectedCount === 0` (tooltip: "Select at least one company")
    2. Run button disabled when `hasProfile === false` (tooltip: "Select a skills profile")
    3. Run button disabled when `status !== 'idle'`
    4. Run button enabled when `status === 'idle'`, `selectedCount > 0`, `hasProfile === true`
    5. Clicking Run calls `onRun`
    6. Stop button visible only when `status === 'running'`
    7. Clicking Stop calls `onStop`
    8. Stop button hidden when `status === 'idle'`, `'complete'`, or `'error'`
- **Testing criteria:** All 8 named test cases pass
- **Completion criteria:** `npm test --workspace=client` passes clean

---

### T16: Build `BulkProgressBar` Component

- **Dependencies:** None
- **Starting criteria:** `npm test --workspace=client` passes clean
- **Implementation scope:**
  - Create [`client/src/components/BulkProgressBar.tsx`](client/src/components/BulkProgressBar.tsx) (new file)
  - Props: `companyStatuses: CompanyStatus[]` (where `CompanyStatus = { token: string; name: string; status: 'pending' | 'running' | 'success' | 'error'; error?: string }`), `currentCompany: string | null`
  - Renders horizontal bar with coloured segments per company
  - Colour coding: grey (pending), blue (running), green (success), red (error)
  - Shows "X of Y companies done" text
  - Error segments show tooltip with error message on hover
  - Create [`client/src/components/BulkProgressBar.test.tsx`](client/src/components/BulkProgressBar.test.tsx) (new file) — test cases:
    1. Shows correct "X of Y companies done" text based on success+error count vs total
    2. Renders colour-coded segments: pending=grey, running=blue, success=green, error=red
    3. Error segment shows tooltip with error message on hover
    4. Handles all-pending state (0 of N done)
    5. Handles all-complete state (N of N done)
    6. Highlights current company (running state segment distinct)
- **Testing criteria:** All 6 named test cases pass
- **Completion criteria:** `npm test --workspace=client` passes clean

---

### T17: Build `ViewModeToggle` Component

- **Dependencies:** None
- **Starting criteria:** `npm test --workspace=client` passes clean
- **Implementation scope:**
  - Create [`client/src/components/ViewModeToggle.tsx`](client/src/components/ViewModeToggle.tsx) (new file)
  - Props: `mode: 'merged' | 'by-company'`, `onChange: (mode: 'merged' | 'by-company') => void`
  - Two toggle buttons or radio buttons: "Merged View" (default) and "By Company"
  - Active mode highlighted
  - Create [`client/src/components/ViewModeToggle.test.tsx`](client/src/components/ViewModeToggle.test.tsx) (new file) — test cases:
    1. Renders both "Merged View" and "By Company" options
    2. "Merged View" selected by default when `mode='merged'`
    3. Clicking "By Company" fires `onChange('by-company')`
    4. Clicking "Merged View" fires `onChange('merged')`
- **Testing criteria:** All 4 named test cases pass
- **Completion criteria:** `npm test --workspace=client` passes clean

---

### T18: Build `ScoreThresholdSlider` Component

- **Dependencies:** None
- **Starting criteria:** `npm test --workspace=client` passes clean
- **Implementation scope:**
  - Create [`client/src/components/ScoreThresholdSlider.tsx`](client/src/components/ScoreThresholdSlider.tsx) (new file)
  - Props: `value: number` (0–100), `onChange: (value: number) => void`, `disabled?: boolean`
  - Renders `<input type="range" min="0" max="100" step="1" />`
  - Shows current value as label: "Min score: {displayValue}" where displayValue = value / 10 (e.g., 70 → "7")
  - Disabled state greys out the slider
  - Create [`client/src/components/ScoreThresholdSlider.test.tsx`](client/src/components/ScoreThresholdSlider.test.tsx) (new file) — test cases:
    1. Renders range input with min=0, max=100, step=1
    2. Displays current value label (e.g., value=70 → "Min score: 7")
    3. Fires `onChange` when slider value changes
    4. Slider is disabled when `disabled=true`
    5. Default value is 0 (no filtering)
- **Testing criteria:** All 5 named test cases pass
- **Completion criteria:** `npm test --workspace=client` passes clean

---

### T19: Build `BulkScoredJobsList` Component

- **Dependencies:** T04 (needs `DedupedJobSummary` type from client types)
- **Starting criteria:** T04 complete; `npm test --workspace=client` passes clean
- **Implementation scope:**
  - Create [`client/src/components/BulkScoredJobsList.tsx`](client/src/components/BulkScoredJobsList.tsx) (new file)
  - Props: `scoredJobs: DedupedJobSummary[]`
  - Reuses visual rendering pattern from existing [`ScoredJobsList`](client/src/components/ScoredJobsList.tsx) (job cards with score, title, department, location)
  - **Additions over ScoredJobsList:**
    - Company tags/badges showing which companies the job came from (e.g., "Figma", "Databricks" chips)
    - Per-company score breakdown in a tooltip or inline small text (e.g., "Figma: 9 · Databricks: 7")
  - Jobs sorted by score descending (already pre-sorted by server; component may re-sort defensively)
  - Create [`client/src/components/BulkScoredJobsList.test.tsx`](client/src/components/BulkScoredJobsList.test.tsx) (new file) — test cases:
    1. Renders list of dedup'd jobs with title, score, department, location
    2. Shows company badges/tags for each job
    3. Shows per-company score breakdown (tooltip or inline)
    4. Sorts jobs by score descending
    5. Renders empty state when `scoredJobs` is empty array
    6. Renders single-company job (no dedup needed, one badge)
- **Testing criteria:** All 6 named test cases pass
- **Completion criteria:** `npm test --workspace=client` passes clean

---

### T20: Build `CompanyAccordion` Component

- **Dependencies:** T04 (needs `DedupedJobSummary` type)
- **Starting criteria:** T04 complete; `npm test --workspace=client` passes clean
- **Implementation scope:**
  - Create [`client/src/components/CompanyAccordion.tsx`](client/src/components/CompanyAccordion.tsx) (new file)
  - Props: `companies: CompanyStatus[]`, `scoredJobsByCompany: Record<string, DedupedJobSummary[]>`, `threshold: number` (0–100)
  - Renders collapsible accordion sections — one per company
  - Each section header: company name, job count (post-threshold), error badge if company failed
  - Expanded section: renders jobs using the existing `ScoredJobsList` component (or inline rendering)
  - Failed company sections: show error message, no jobs listed
  - Companies with 0 jobs (post-threshold filter) show "0 jobs found" and are not expandable (or expand to empty)
  - Score threshold filter applied client-side: `job.score >= threshold / 10`
  - Create [`client/src/components/CompanyAccordion.test.tsx`](client/src/components/CompanyAccordion.test.tsx) (new file) — test cases:
    1. Renders per-company sections for each company in the list
    2. Shows job count in section header
    3. Shows error badge for failed companies
    4. Clicking section header expands/collapses to show jobs
    5. Applies score threshold filter (jobs with score below threshold are hidden)
    6. Shows "0 jobs found" for companies with no jobs post-threshold, and the section is not expandable
    7. Failed company section shows error message, not jobs
    8. Success company with jobs renders using ScoredJobsList pattern
- **Testing criteria:** All 8 named test cases pass
- **Completion criteria:** `npm test --workspace=client` passes clean

---

### T21: Build `AllCompaniesPage` Composition

- **Dependencies:** T10 (useBulkPipelineStream hook), T13 (ProfileSelector), T14 (CompanyCheckboxList), T15 (BulkRunControls), T16 (BulkProgressBar), T17 (ViewModeToggle), T18 (ScoreThresholdSlider), T19 (BulkScoredJobsList), T20 (CompanyAccordion)
- **Starting criteria:** T10, T13–T20 all complete; `npm test --workspace=client` passes clean
- **Implementation scope:**
  - Create [`client/src/components/AllCompaniesPage.tsx`](client/src/components/AllCompaniesPage.tsx) (new file)
  - Composition component that wires all sub-components together:
    - Manages `selectedProfile`, `selectedCompanies` (Set), `viewMode`, `scoreThreshold` state
    - Uses `useBulkPipelineStream` hook for pipeline state and controls
    - Renders layout per §8.2.4 of spec:
      - ProfileSelector + CompanyCheckboxList in a control section
      - BulkRunControls for Run/Stop
      - BulkProgressBar + StagePanel when running or complete
      - ViewModeToggle + ScoreThresholdSlider when results exist
      - BulkScoredJobsList (merged view) or CompanyAccordion (by-company view)
      - Idle state: "Select companies and a skills profile, then click Run."
    - Score threshold filtering via `useMemo` (converts 0-100 to 0-10 scale)
    - Tab change disabled during run (managed by App.tsx parent via context/prop)
  - Create [`client/src/components/AllCompaniesPage.test.tsx`](client/src/components/AllCompaniesPage.test.tsx) (new file) — integration test cases:
    1. Renders all control sub-components (ProfileSelector, CompanyCheckboxList, BulkRunControls) in idle state
    2. Shows idle message when status is 'idle'
    3. Shows BulkProgressBar and StagePanel when status is 'running'
    4. Shows BulkScoredJobsList in merged view when status is 'complete'
    5. Shows CompanyAccordion when viewMode is 'by-company'
    6. Switches between merged and by-company views via ViewModeToggle
    7. Score threshold slider filters jobs in both views
    8. Run button triggers `start()` from hook; Stop button triggers `stop()`
    9. Shows "All companies failed" message and error badges for each company when status='complete', dedupedJobs=[], and failures array is populated
  - Tests mock `useBulkPipelineStream` hook to return controlled state (avoid testing hook+component together)
- **Testing criteria:** All 9 named test cases pass
- **Completion criteria:** `npm test --workspace=client` passes clean

---

### T22: Wire `App.tsx` with Tab Navigation and `AllCompaniesPage`

- **Dependencies:** T11 (TabBar), T12 (SingleCompanyPage), T21 (AllCompaniesPage)
- **Starting criteria:** T11, T12, T21 complete; `npm test --workspace=client` passes clean
- **Implementation scope:**
  - Modify [`client/src/App.tsx`](client/src/App.tsx):
    1. Add state: `const [activeTab, setActiveTab] = useState<'single' | 'all'>('single');`
    2. Determine tab disabled: `const tabDisabled = singlePipelineStatus !== 'idle' || bulkPipelineStatus !== 'idle';` (need to lift pipeline status from SingleCompanyPage or use context)
    3. Render `<TabBar activeTab={activeTab} onTabChange={setActiveTab} disabled={tabDisabled} />`
    4. Conditionally render `<SingleCompanyPage />` or `<AllCompaniesPage />` based on `activeTab`
  - The single-company pipeline status needs to be accessible at the App level for TabBar disabled state. Options:
    - Lift the `usePipelineStream` hook to App.tsx and pass state down to SingleCompanyPage
    - Use React context
    - Recommended: lift the hook to App and pass as props (simplest, no new files)
  - Modify [`client/src/App.test.tsx`](client/src/App.test.tsx) — update/add test cases:
    1. TabBar renders and defaults to "Single Company" tab
    2. Clicking "All Companies" tab switches to AllCompaniesPage
    3. Clicking "Single Company" tab switches back
    4. Tabs are disabled during a pipeline run
    5. Existing single-company functionality still works (no regressions)
  - No other behavioural changes to the single-company flow
- **Testing criteria:** All 5 named test cases pass; all existing App tests pass
- **Completion criteria:** `npm test --workspace=client` passes clean; `npm test --workspace=server` passes clean; tab navigation works end-to-end

---

## Issues Found and Resolved

### Issue 1: Rule 18 — Missing Output File Pattern
**Found:** The current Rule 18 in [`AGENTS.md`](AGENTS.md:57-58) only permits `output/processed_ids.json` and `output/{company}-{date}.json`. Phase 2 adds `output/all-companies-{date}.json`.

**Resolution:** Task T00 updates Rule 18 before any output file code is written. This was already noted in §13 of the spec.

**Severity:** Blocker — must be done first.

---

### Issue 2: `PipelineRunOptions` References Config Types
**Found:** The `PipelineRunOptions` interface (added to [`server/src/types/index.ts`](server/src/types/index.ts)) needs to reference `CompanyConfig` and `SkillsProfile` from [`server/src/config/types.ts`](server/src/config/types.ts). Per Rule 9, all shared interfaces must be in `types/index.ts`. The `config/types.ts` file is the correct home for config-specific types, and `types/index.ts` imports from it.

**Resolution:** `types/index.ts` imports `CompanyConfig` and `SkillsProfile` from `../config/types`. This is consistent with how other types (e.g., `FilterConfig`) work. No rule violation — Rule 9 prohibits redefining types elsewhere, not cross-file imports.

**Severity:** Non-issue (works as designed).

---

### Issue 3: Emit Type Bridge — Contravariance
**Found:** The bulk orchestrator passes `emit: BulkEmitCallback` (accepts `AnyPipelineEvent`) to `runPipeline(token, emit, options)` which expects `EmitCallback` (accepts only `PipelineEvent`). There was a concern this might not type-check.

**Resolution:** In TypeScript, function parameters are contravariant. Since `PipelineEvent` ⊆ `AnyPipelineEvent` (PipelineEvent is a subset of the AnyPipelineEvent union), `(event: AnyPipelineEvent) => void` IS assignable to `(event: PipelineEvent) => void`. The bulk orchestrator's emit can be passed directly to `runPipeline`. Verified.

**Severity:** Non-issue (correct by TypeScript variance rules).

---

### Issue 4: `executeStage3` Passes `companyConfig.name`
**Found:** In `runPipeline` line 427: `companyConfig.name` is passed as `companyName` to `executeStage3`. With pre-loaded configs via `PipelineRunOptions`, this field comes from the provided `CompanyConfig` object.

**Resolution:** No change needed. The `CompanyConfig` type always has a `name: string` field. Pre-loaded configs are validated before being passed to `runPipeline`, so `name` is always present.

**Severity:** Non-issue.

---

### Issue 5: Test Isolation for `bulkOrchestrator`
**Found:** The bulk orchestrator calls `runPipeline` internally. Testing the bulk orchestrator requires mocking `runPipeline` to avoid making real Greenhouse/DeepSeek calls (Rule 8).

**Resolution:** All 12 test cases for `bulkOrchestrator.test.ts` mock `runPipeline` via `jest.mock('../pipeline/orchestrator', ...)`. The mock returns controlled `PipelineRunOutput` objects. Each test case provides different mock implementations to simulate success, failure, and varied job data for dedup testing.

**Severity:** Design note — specified in testing criteria for T06.

---

### Issue 6: Client Hook — `EventSource` vs `fetch()`
**Found:** The existing `usePipelineStream` hook uses `EventSource` (GET-based). The bulk hook MUST use `fetch()` with POST and manual SSE parsing from `ReadableStream` because `EventSource` does not support POST with a request body.

**Resolution:** Task T10 implements the pattern from Appendix C of the spec. Tests mock `fetch` and provide mock `ReadableStream` instances. The hook does NOT use `EventSource`. This is a deliberate design difference documented in the spec.

**Severity:** Design constraint — reflected in T10 testing criteria.

---

### Issue 7: Pre-Flight Validation Must Be All-or-Nothing
**Found:** The spec requires all company configs and the skills profile to be validated BEFORE opening the SSE stream (§3.2). If any validation fails, return 400 JSON — do not start a partial run.

**Resolution:** Task T08 explicitly implements pre-flight validation as a separate step before SSE headers are set. The route handler loads all configs first; if any fails, it returns 400 JSON and never calls `runBulkPipeline`. This is part of the implementation scope for T08.

**Severity:** Design requirement — explicitly stated in T08 scope.

---

### Issue 8: `GET /api/profiles` Error Handling
**Found:** The spec says to return empty array `[]` when the `profile/` directory doesn't exist or has no `.json` files. Only unexpected FS errors should return 500.

**Resolution:** Task T02 implementation includes a try/catch that returns `[]` on `ENOENT` (directory not found) and re-throws other errors for the Express error handler to convert to 500.

**Severity:** Design note — captured in T02 testing criteria.

---

### Issue 9: Client Component Tests Must Mock `fetch`
**Found:** Components like `ProfileSelector` and `CompanyCheckboxList` call `GET /api/profiles` and `GET /api/companies` on mount. These must be mocked in tests (Rule 8 applies to client tests too — no live HTTP to server endpoints that might trigger Greenhouse/DeepSeek).

**Resolution:** All client component tests with `fetch` calls mock `global.fetch` via `jest.spyOn` or similar. The mocked `fetch` returns controlled JSON responses. This is specified in each component's testing criteria.

**Severity:** Testing constraint — applied consistently across T13, T14, and any component that calls `fetch`.

---

### Issue 10: Original Plan §14 Task Grouping
**Found:** The original plan's task list (§14) groups tests separately from implementation (T-0 through T-6 as "Test Tasks"). Per Rule 14, tests must be written first for each implementation task, then confirmed failing, then implementation written.

**Resolution:** This breakdown integrates tests into each task rather than separating them. Each task's "Implementation scope" includes writing the test file, and "Testing criteria" lists the specific test cases. The "Starting criteria" confirms tests are written and failing before implementation proceeds. This ensures Rule 14 compliance at the task level.

**Severity:** Process improvement — the integrated approach prevents the "write all tests, then write all code" anti-pattern where tests and implementation drift apart.

---

### Issue 11: Number of Client Components
**Found:** The original plan lists 13 client subtasks (C-1 through C-13). Some are tightly coupled (e.g., C-12 CompanyAccordion and C-13 AllCompaniesPage). The breakdown here keeps the same granularity but adds explicit dependency information and testing criteria for each.

**Resolution:** Tasks T11–T22 cover all client work with clear dependencies. Components that only depend on types (not on other components) can be built in parallel. The `AllCompaniesPage` composition (T21) is the only component that depends on all others.

**Severity:** Organizational — no changes to what gets built, just how tasks are organized.

---

### Issue 12: Single-Company Pipeline Status for TabBar Disabled State
**Found:** The TabBar must be disabled during any pipeline run (single or bulk). This requires the single-company pipeline status to be known at the App level.

**Resolution:** Task T22 specifies lifting the `usePipelineStream` hook to `App.tsx` and passing state down to `SingleCompanyPage` as props. This is the simplest approach that doesn't require new infrastructure (no context, no state management library).

**Severity:** Design note — documented in T22 implementation scope.

---

### Issue 13 (M-1): T06 Missing Companies-Array Deduplication
**Found:** The `runBulkPipeline` implementation scope did not deduplicate the input `companies` array. If a caller passes `['figma', 'figma', 'databricks']`, figma would run twice.

**Resolution:** Added step 1 to T06 Implementation Scope: `const uniqueCompanies = [...new Set(companies)];` and iterate over `uniqueCompanies`. Added test case 2: "Duplicate company tokens in input array are collapsed to unique before execution."

**Severity:** Moderate — duplicate runs waste API calls and pollute results.

---

### Issue 14 (M-2): T21 Missing "All Companies Fail" Test
**Found:** T21's `AllCompaniesPage` test cases had no coverage for the scenario where every company fails (dedupedJobs empty, failures populated).

**Resolution:** Added test case 9: "Shows 'All companies failed' message and error badges for each company when status='complete', dedupedJobs=[], and failures array is populated."

**Severity:** Moderate — missing error-state coverage.

---

### Issue 15 (M-3): T10 Missing useEffect Cleanup (Unmount) Test
**Found:** T10's `useBulkPipelineStream` tests did not verify that unmounting during a running stream triggers `abortController.abort()`.

**Resolution:** Added test case 11: "Unmounting the component during a running stream calls abortController.abort() — use renderHook's unmount() to verify the AbortSignal is triggered on cleanup."

**Severity:** Moderate — resource leak risk without cleanup verification.

---

### Issue 16 (M-4): T08 Pre-Flight Load Order Was Ambiguous
**Found:** T08's pre-flight validation steps did not specify whether profile and company configs should be loaded sequentially or in parallel, and did not clarify that profile validation should happen first.

**Resolution:** Rephrased to be explicitly sequential: "2a. Load profile first via loadSkillsProfile(profile); return 400 immediately if not found. 2b. THEN load each company config via loadCompanyConfig(token); return 400 with detail listing ALL missing tokens if any fail."

**Severity:** Moderate — ambiguous ordering could lead to inconsistent error reporting.

---

### Issue 17 (M-5): T03 Missing Circular-Dependency Verification
**Found:** `PipelineRunOptions` in `types/index.ts` references `CompanyConfig` and `SkillsProfile` from `../config/types`. If `config/types.ts` imports from `../types`, a circular dependency would break compilation.

**Resolution:** Added to T03 Starting Criteria: "Verify that server/src/config/types.ts does NOT import from ../types (no circular dependency). If it does, PipelineRunOptions must use type-only imports or CompanyConfig/SkillsProfile must be moved into types/index.ts."

**Severity:** Moderate — would block compilation if not verified.

---

### Issue 18 (M-6): T12 Missing Dedicated Test File for SingleCompanyPage
**Found:** T12 only mentioned updating `App.test.tsx` but did not include a dedicated smoke test file for the new `SingleCompanyPage` component.

**Resolution:** Added creation of `client/src/components/SingleCompanyPage.test.tsx` with smoke tests: renders without crashing, passes children through, shows RunControls, shows StagePanel, shows ScoredJobsList. Updated Testing Criteria to include the new test file.

**Severity:** Moderate — new component without dedicated tests violates test-first discipline.

---

### Issue 19 (m-1): T03 Type Count Mismatch
**Found:** The preamble stated "16 new types" but the actual list in T03 counted 17 items.

**Resolution:** Changed "16 new types" to "17 new types" in the preamble.

**Severity:** Minor — documentation accuracy.

---

### Issue 20 (m-2): T06 Dedup Test Composability Noted
**Found:** Dedup tests for case-insensitivity (test 6) and trailing-slash (test 7) cover orthogonal normalisation concerns. Verified they compose correctly.

**Resolution:** Added note confirming the tests exist and compose correctly. No structural change needed.

**Severity:** Minor — verification only.

---

### Issue 21 (m-3): T10 Test 10 Granularity Concern
**Found:** T10 test 10 bundles multiple SSE parsing sub-concerns (multiple events in one chunk, partial chunks, empty chunks) into a single test case.

**Resolution:** Added note: "Test 10 bundles multiple SSE parsing sub-concerns. If these prove too coupled during implementation, split into separate test cases."

**Severity:** Minor — optional guidance for implementer.

---

### Issue 22 (m-4): T06 `failures` Field Name Consistency Verified
**Found:** Verified that `bulk_complete` uses `failures` (plural) consistently across the spec and task breakdown.

**Resolution:** Added verification note. No structural change needed.

**Severity:** Minor — naming consistency verified, no fix required.

---

### Issue 23 (m-5): T20 Test 6 Missing Non-Expandable Behaviour
**Found:** T20 test 6 described "Shows '0 jobs found' for companies with no jobs post-threshold" but did not specify that the section should also be non-expandable.

**Resolution:** Updated description to: "Shows '0 jobs found' for companies with no jobs post-threshold, and the section is not expandable."

**Severity:** Minor — behavioural completeness for test.

---

### Issue 24 (m-6): T03 Types-Only Validation Deferred
**Found:** T03's Completion Criteria (`npm test` + `tsc` passes) only validates compilation, not full usage correctness of the 17 new types.

**Resolution:** Added note: "type correctness is partially validated by compilation; full usage validation occurs in downstream tasks T05, T06, T08."

**Severity:** Minor — clarifies validation scope.

---

### Issue 25 (m-7): T07 Synchronous I/O Justification
**Found:** T07 uses `fs.mkdirSync` with `{ recursive: true }` without explaining why sync I/O is acceptable.

**Resolution:** Added note: "fs.mkdirSync with { recursive: true } follows the existing persistRun pattern; acceptable for single-user throughput."

**Severity:** Minor — documents design decision.

---

## Summary Statistics

| Category | Count |
|---|---|
| Total tasks | 23 (T00–T22) |
| Server-side tasks | 10 (T00–T09) |
| Client-side tasks | 13 (T10–T22) |
| Tasks with no dependencies | 5 (T00, T01, T03, T11, T12) |
| Tasks that depend on server work | 3 (T10, T19, T20 — type dependencies only) |
| Maximum dependency chain depth | 5 (T00→T03→T05→T06→T08→T09) |
| New files to create (server) | 5 (bulkOrchestrator.ts, bulkPersister.ts, bulk-run.ts + 3 test files) |
| New files to create (client) | 20 (10 components + 10 test files + 1 hook + 1 hook test) |
| Existing files to modify | 9 (AGENTS.md, skillsProfile.ts, config.ts, types/index.ts, orchestrator.ts, server.ts, events.ts, App.tsx, App.test.tsx + 3 test file modifications) |
