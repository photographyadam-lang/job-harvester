# Product Requirements Document (PRD)
## Personal Job Matching Pipeline — MVP (Greenhouse Phase)

> This document is the build specification for an AI coding agent. It defines the
> functional rules, data contracts, file structure, and verification gates needed to
> generate an accurate, step-by-step development backlog.
>
> Stack: **Node.js / TypeScript** (server) + **React / Vite / TypeScript** (client).
> Target ATS: **Greenhouse** only, via unauthenticated public API.

---

## 1. Objective

Build a **local web application** that validates, for a single Greenhouse-backed company,
that a personal job-matching pipeline is correctly configured. The user selects a company,
the pipeline runs end-to-end, and a **live browser UI** streams each stage's results — showing
what passed, what was rejected (with clickable job links for manual spot-checking), and how
each stage is configured.

The primary deliverable is **per-stage validation visibility**, not just a matched-jobs list.
A matched-jobs list with 1–10 scores is the natural output of a successful validation run.

**Explicit non-goal for this MVP:** the overnight multi-company scan. That is a future phase.
This MVP must, however, persist results to disk in a format that future phase can consume
without a rewrite.

---

## 2. Scope & Constraints

- **ATS target:** Greenhouse only (e.g., Figma, Stripe, Uber).
- **Access:** Unauthenticated public API — `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`. No browser automation, no login.
- **Architecture:** Local web app. Express backend + React frontend, communicating over HTTP and Server-Sent Events (SSE).
- **One user:** This is a personal tool. Matching is against a single skills profile (`profile/adam.json`).

---

## 3. Repository Structure

Single monorepo. Every module has one unambiguous home.

```
job-harvester/
├── server/                 # Express + pipeline (Node.js / TypeScript)
│   ├── src/
│   │   ├── pipeline/        # The five stages, one file each
│   │   │   ├── stage1-fetch.ts
│   │   │   ├── stage2-filter.ts
│   │   │   ├── stage3-normalize-extract.ts
│   │   │   ├── stage4-gap-filter.ts
│   │   │   └── stage5-score.ts
│   │   ├── types/           # Shared data contracts (see §4)
│   │   ├── config/          # Config loaders + validation
│   │   ├── llm/             # DeepSeek client + schema validation
│   │   └── server.ts        # Express app, routes, SSE endpoint
│   └── __fixtures__/        # Saved API responses for offline tests
├── client/                  # React frontend (Vite + TypeScript)
│   └── src/
├── config/
│   └── companies/           # figma.json, stripe.json, … (one per company)
├── profile/
│   └── adam.json            # Skills profile + gap threshold
├── output/                  # Saved run results: {company}-{date}.json
└── package.json
```

Run with two commands in two terminals: `npm run server` and `npm run client`.

---

## 4. Data Contracts (define these BEFORE writing stage logic)

These TypeScript interfaces are the contracts that hold the pipeline together. Each stage
consumes the previous stage's output type and produces the next. Define them in
`server/src/types/` first.

```typescript
// Raw job straight from the Greenhouse API
interface RawJob {
  id: number;
  title: string;
  absolute_url: string;        // the clickable job link
  location: { name: string };
  departments: { name: string }[];
  content: string;             // HTML-encoded job body
}

// Survived Stage 2 metadata filter
interface FilteredJob extends RawJob {
  matchedLocation: string;
  matchedDepartment: string;
}

// Survived Stage 3 normalize + extract
interface ExtractedJob {
  id: number;
  title: string;               // cleaned title
  company: string;
  url: string;
  location: string;
  department: string;
  cleanedDescription: string;  // normalized markdown body
  extracted: {
    must_haves: string[];
    nice_to_haves: string[];
    years_experience_required: number | null;
  };
}

// Survived Stage 4 gap filter
interface GatedJob extends ExtractedJob {
  matchedMustHaves: string[];
  unmatchedMustHaves: string[];
  gapRatio: number;            // unmatched / total
}

// Final output after Stage 5 scoring
interface ScoredJob extends GatedJob {
  score: number;              // 1–10
  scoreReasoning: string;     // one sentence
}
```

Every stage also emits a **rejection record** for any job it drops, so the UI can show what
was filtered and why:

```typescript
interface RejectedJob {
  id: number;
  title: string;
  url: string;
  rejectedAtStage: 1 | 2 | 3 | 4 | 5;
  reason: string;             // human-readable, e.g. "Location 'London' not in target list"
}
```

---

## 5. Configuration Files

### 5.1 Per-company config — `config/companies/{company}.json`

Everything needed to onboard a company lives in one file. Getting this file right *is* the
onboarding task.

```json
{
  "token": "figma",
  "companyName": "Figma",
  "targetLocations": ["Remote", "Austin", "Seattle", "Portland"],
  "targetDepartments": ["Engineering", "Product Management", "Legal & Compliance"],
  "roleNameKeywords": ["privacy", "program manager", "compliance"],
  "sectionHeaders": {
    "mustHaves": "We'd love to hear from you if you have:",
    "niceToHaves": "While it's not required, it's an added plus if you also have:"
  }
}
```

- `targetLocations` / `targetDepartments` / `roleNameKeywords` drive Stage 2 filtering.
- `sectionHeaders` are the heuristic anchors for Stage 3 extraction (confirmed present in
  real Figma HTML). When a header is found, extraction can be done with a local string split;
  when absent, fall back to the LLM.

### 5.2 Skills profile — `profile/adam.json`

Personal matching config. Lives separately from company config because it's the same across
all companies.

```json
{
  "gapThreshold": 0.20,
  "skills": [
    {
      "name": "privacy",
      "strength": "high",
      "aliases": ["data privacy", "GDPR", "privacy compliance", "data protection"]
    },
    {
      "name": "program management",
      "strength": "high",
      "aliases": ["program manager", "technical program management", "TPM"]
    }
  ]
}
```

- `strength` is `"high" | "medium" | "low"`.
- A must-have is **matched** if it matches `name` OR any `alias`, at **any** strength level.
  Low-strength matches count as full coverage — the threshold does all the tuning.
- `gapThreshold` is tunable from the UI (default `0.20`).

### 5.3 Secrets — `.env`

```
DEEPSEEK_API_KEY=...
```

API keys never live in config JSON. Server-only; never exposed to the client.

---

## 6. The Five-Stage Pipeline

```
[1: Fetch] → [2: Metadata Filter] → [3: Normalize + Extract] → [4: Gap Filter] → [5: Score]
                                            ↑
                              (Dedup check happens before Stage 3 — see §7)
```

Each stage streams its results to the browser via SSE as it completes, emitting both the
jobs moving forward and the `RejectedJob` records for jobs it dropped.

### Stage 1 — Fetch
- Given a company token, fetch the full job catalog in one request.
- **Gate:** HTTP 200 and a valid `jobs` array. Log total raw roles found.
- If the request fails or returns zero jobs, stop and report the error to the UI.

### Stage 2 — Metadata Filter (raw data only)
Filters using data already present in the API response — no text processing:
- **Location:** retain only jobs whose location matches `targetLocations` (case-insensitive substring match — "Remote" should match "Remote (US)").
- **Department:** retain only jobs in `targetDepartments`.
- **Role name:** retain only jobs whose title contains at least one `roleNameKeyword`.
- **Gate:** Log remaining count. If it drops to zero, stop and flag a **config mismatch alert**
  (the most likely cause is a wrong department name or location string in the company config).

### Stage 3 — Normalize + Extract
First **normalize** the HTML, then **extract** structured fields.

**Normalization (in order):**
1. **HTML entity decode:** the API returns HTML-encoded content (`&lt;div&gt;`). Decode first.
2. **Encoding repair:** fix mojibake from UTF-8/Latin-1 corruption. Confirmed cases in real
   data: `â` → `'` (e.g. `Figmaâs` → `Figma's`, `wonât` → `won't`, `youâll` → `you'll`).
   Use a library (`he` for entities; a mojibake fix for the `â` artifacts) rather than a
   hand-rolled character map.
3. **Boilerplate truncation:** locate `<div class="content-conclusion">` and strip it and
   everything after it. **Keep** everything before it, **including** `content-intro`.
   `content-conclusion` is confirmed present in real Figma HTML and wraps exactly the EEO /
   accommodations / privacy boilerplate to remove.
4. **Markdown conversion:** `<h4>` → `###`, `<li>` → `* `. Strip remaining tags.

- **Gate:** body text remains non-empty after normalization. (No fixed compression % — that
  metric was removed as unimplementable. Assert the cleaned body is non-empty and that
  `content-conclusion` boilerplate is absent.)

**Extraction (hybrid):**
1. **Heuristic attempt:** if the config `sectionHeaders` strings are found in the normalized
   markdown, split locally to pull the must-have / nice-to-have lists. No LLM call needed.
2. **LLM fallback:** if a header is not found, send the cleaned markdown to DeepSeek
   (`deepseek-chat`, via the `openai` npm package with `baseURL: "https://api.deepseek.com"`)
   requesting JSON output. **Validate the returned JSON against the `extracted` schema before
   accepting it** — a missing or wrong-typed field (e.g. `years_experience_required` not a
   number-or-null) must throw a named error, not write a malformed record.
- Track per-run: `heuristicHits` vs `llmFallbacks` (see §8 report card — surfaces heuristic decay).

### Stage 4 — Skills Gap Filter (programmatic)
- For each extracted job, compare `extracted.must_haves` against `profile/adam.json`.
- A must-have is matched if it matches a skill `name` or any `alias` (case-insensitive,
  substring) at any strength.
- Compute `gapRatio = unmatchedMustHaves.length / must_haves.length`.
- **Filter out** if `gapRatio >= gapThreshold`. Emit a `RejectedJob` listing which must-haves
  were unmatched.

### Stage 5 — LLM Scoring & Ranking
- For each job that passed Stage 4, send the job (title, description, must/nice-to-haves) plus
  the skills profile to DeepSeek.
- Request a **1–10 score** and **one sentence of reasoning**, as validated JSON.
- Sort surviving jobs by score, descending.

---

## 7. Non-Functional Guardrails

- **Deduplication:** before Stage 3 (the first expensive stage), check each job ID against
  `output/processed_ids.json`. If already successfully processed, skip it and emit a
  `RejectedJob` with reason `"Already processed"`. Update the cache only after a job
  completes Stage 5 successfully.
- **LLM rate limiting:** minimum 1.5 s delay between consecutive DeepSeek calls.
- **Persistence:** on every run, stream results live to the UI **and** simultaneously write
  `output/{company}-{YYYY-MM-DD}.json` containing all `ScoredJob` records plus the run's
  rejection records. This file is the input contract for the future overnight-scan phase.

---

## 8. Diagnostic Report Card

At the end of a run, the UI shows a scannable summary with named fields:

```typescript
interface ReportCard {
  company: string;
  runTimestamp: string;
  stages: {
    stage: 1 | 2 | 3 | 4 | 5;
    name: string;
    status: "pass" | "fail";
    inputCount: number;
    outputCount: number;
    rejectedCount: number;
    error?: string;
  }[];
  heuristicHits: number;       // Stage 3: extraction without LLM
  llmFallbacks: number;        // Stage 3: extraction needing LLM
  llmCallsTotal: number;       // Stage 3 + Stage 5
  estimatedCost: number;       // USD, from token counts
  totalRuntimeMs: number;
}
```

A spike in `llmFallbacks` relative to `heuristicHits` is the early-warning signal that
Greenhouse changed a company's HTML template and the `sectionHeaders` config needs updating.

---

## 9. Browser UI (React / Vite)

- **Company selector:** pick which `config/companies/*.json` to run.
- **Config editor:** view and edit the selected company's config and the skills profile in the
  browser; save writes back to the JSON files on disk via the Express server.
- **Live stage view:** five panels, one per stage. As the pipeline runs, each panel updates in
  real time over SSE — showing its config, jobs moved forward, and jobs rejected (with reason).
- **Clickable job links:** every job in every panel links to its `absolute_url` for manual
  spot-checking.
- **Report card:** rendered at the end of the run from the `ReportCard` object.

**Transport:** Server-Sent Events. The pipeline is one-directional (server → browser), so SSE
is the correct choice over WebSockets — simpler, native `EventSource` in the browser, no
extra library.

---

## 10. Test Strategy (write tests BEFORE the stage they cover)

The original "test harness" framing had no actual tests. These are required.

- **Fixtures first:** save one real Greenhouse API response to `server/__fixtures__/figma-jobs.json`
  before writing any other test. All Stage 1–4 tests run against fixtures — deterministic, offline.
- **Stage 1:** valid response parses; non-200 stops; empty `jobs` array stops.
- **Stage 2:** location retained / excluded; department retained / excluded; role-keyword
  retained / excluded; zero-survivors triggers the config-mismatch alert.
- **Stage 3 normalization:** entity decode; mojibake repair (`Figmaâs` → `Figma's`);
  truncation when `content-conclusion` present; `content-intro` retained; `<h4>`/`<li>` → markdown.
- **Stage 3 extraction:** heuristic hit (Figma headers found, correct split); heuristic miss
  triggers LLM path; LLM response failing schema validation throws the named error.
- **Stage 4:** exact-name match; alias match; low-strength match counts as coverage;
  gapRatio computation; threshold boundary (exactly at threshold vs just under).
- **Stage 5:** score is within 1–10; reasoning present; output schema validates.

Exit criterion for any build session: `npm test` clean. Not manual smoke-testing.

---

## 11. Definition of Done

The MVP is complete when:
1. Selecting a configured company and pressing run executes all five stages live in the browser.
2. Each stage panel shows its config, what moved forward, and what was rejected (with reasons
   and clickable links).
3. The run produces a ranked list of matched jobs each with a 1–10 score and one-sentence reason.
4. Results are saved to `output/{company}-{date}.json`.
5. The report card shows per-stage pass/fail, counts, heuristic-vs-LLM ratio, and cost.
6. `npm test` passes against fixtures with no live API dependency.

---

## 12. Build Sequencing (suggested backlog order)

1. Repo scaffold (monorepo, server + client, TypeScript configs, npm scripts).
2. Data contracts (`server/src/types/`) — all interfaces from §4.
3. Config loaders + validators for company config and skills profile.
4. Stage 1 + Figma fixture + Stage 1 tests.
5. Stage 2 + tests.
6. Stage 3 normalization + tests (no LLM yet).
7. DeepSeek client + schema validator + Stage 3 extraction (heuristic, then LLM fallback) + tests.
8. Stage 4 + tests.
9. Stage 5 + tests.
10. Dedup cache + persistence to `output/`.
11. Express server + SSE endpoint wiring the pipeline.
12. React UI: company selector → live stage panels → report card.
13. Config editor in the UI (read/write JSON files).

Each step is independently testable and produces a verifiable result before the next begins.
