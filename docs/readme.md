# Job Harvester

A full-stack application that fetches job postings from [Greenhouse](https://www.greenhouse.io/) job boards, filters them against your skills profile, and scores them using AI (DeepSeek) to find the best matching roles.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18+ (with `npm`)
- A [DeepSeek API key](https://platform.deepseek.com/) (required for Stages 3 and 5 which use LLM calls)

---

## Setup

### 1. Install dependencies

From the project root, run:

```bash
npm install
```

This installs dependencies for both the `server` and `client` workspaces (defined in [`package.json`](../package.json)).

### 2. Configure environment variables

Copy the example environment file and add your DeepSeek API key:

```bash
cp .env.example .env
```

Then edit `.env` and set your key:

```
DEEPSEEK_API_KEY=sk-your-actual-key-here
```

> **Important:** The `DEEPSEEK_API_KEY` must live in `.env` only. It must never appear in config JSON files, TypeScript source files, log output, or API responses.

### 3. Configure companies

Company config files live in [`server/config/companies/`](../server/config/companies/). Each file is named `{token}.json` (e.g., `figma.json`).

A company config looks like this:

```json
{
  "name": "Figma",
  "departments": ["Engineering", "Product", "Design"],
  "sectionHeaders": {
    "must_have": ["About the role", "What you'll do"],
    "nice_to_have": ["Nice to have"]
  }
}
```

| Field | Description |
|---|---|
| `name` | Human-readable company name |
| `departments` | Departments to include (jobs outside these are rejected at Stage 2) |
| `sectionHeaders.must_have` | Heading keywords that identify must-have requirement sections in job postings |
| `sectionHeaders.nice_to_have` | Heading keywords that identify nice-to-have sections |

### 4. Configure your skills profile

Your skills profile lives at [`server/profile/adam.json`](../server/profile/adam.json):

```json
{
  "skills": [
    { "name": "TypeScript", "strength": "must_have" },
    { "name": "React", "strength": "must_have" },
    { "name": "PostgreSQL", "strength": "nice_to_have" }
  ],
  "gapThreshold": 0.5
}
```

| Field | Description |
|---|---|
| `skills` | Your skill inventory — each entry has a `name` and a `strength` (`must_have`, `nice_to_have`, or `preferred`) |
| `gapThreshold` | Maximum acceptable gap ratio (0–1). A job whose fraction of unmatched must-haves meets or exceeds this threshold is rejected at Stage 4 |

---

## Starting the Application

### Start the server

The server is an Express.js API running on port **3001**.

```bash
npm run dev --workspace=server
```

This starts the server with `ts-node-dev`, which automatically restarts on file changes.

The server exposes the following API endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/companies` | List available company tokens |
| `GET` | `/api/config/company/:token` | Load a company's config |
| `PUT` | `/api/config/company/:token` | Save a company's config (validated) |
| `GET` | `/api/config/profile` | Load the skills profile |
| `PUT` | `/api/config/profile` | Save the skills profile (validated) |
| `GET` / `POST` | `/api/run/:token` | Run the pipeline for a company (SSE stream) |

### Start the client (development)

The client is a React + Vite app running on port **5173**.

```bash
npm run dev --workspace=client
```

This starts the Vite dev server. Open [http://localhost:5173](http://localhost:5173) in your browser.

In development mode, the Vite dev server proxies all `/api` requests to the backend at `http://localhost:3001` (configured in [`client/vite.config.ts`](../client/vite.config.ts)).

### Build the client for production

```bash
npm run build --workspace=client
```

This produces a production build in `client/dist/`. In production mode (`NODE_ENV=production`), the Express server serves the static client build from its `/api` routes.

---

## How to Use the App

### 1. Select a company

Open the app in your browser. Use the **Company** dropdown to select a company (e.g., `figma`). The list of companies is populated from config files in `server/config/companies/`.

### 2. Review and edit configuration

Once a company is selected, the **Configuration Editor** panel appears. It has two sections:

**Company Config** — Edit the company name, allowed departments (comma-separated), and the section header keywords used for extraction.

**Skills Profile** — Edit your skill inventory (add/remove skills, set strength levels) and the gap threshold.

> Click the **Save Company Config** / **Save Skills Profile** buttons to persist changes. Unsaved changes will disable the **Run Pipeline** button.

### 3. Run the pipeline

Click **Run Pipeline**. The app streams real-time events from the server via Server-Sent Events (SSE) as the pipeline progresses through five stages.

### 4. Watch pipeline stages

Each stage is displayed in a separate panel:

| Stage | Label | What it does |
|---|---|---|
| 1 | Fetch jobs | Fetches the Greenhouse job catalog for the selected company |
| 2 | Metadata filter | Filters jobs by department (and optionally by location/keyword) |
| 3 | Extract requirements | Extracts must-have and nice-to-have requirements from job descriptions (heuristic + LLM fallback) |
| 4 | Gap filter | Compares must-haves against your skills profile; rejects jobs with too many skill gaps |
| 5 | Score jobs | Scores remaining jobs 1–10 using DeepSeek AI based on overall match quality |

Jobs that pass a stage appear in green; rejected jobs appear in red with a reason.

### 5. View results

When the pipeline completes, two sections appear:

- **Report Card** — A summary showing per-stage pass/fail counts, total runtime, estimated LLM cost (USD), and heuristic vs. LLM extraction ratio.
- **Scored Jobs** — The final ranked list of jobs, sorted by score descending. Each job card includes the score badge, reasoning, matched/unmatched skills, and required skills from the posting.

### 6. Pipeline output files

After a successful run, the server persists results to the [`output/`](../output/) directory:

- `{company}-{YYYY-MM-DD}.json` — The full pipeline run output (all jobs, scores, report card)
- `processed_ids.json` — A deduplication cache of processed job IDs (prevents re-processing the same jobs on subsequent runs)

---

## Running Tests

```bash
npm test --workspace=server
```

Tests use fixtures from `server/__fixtures__/` and mock HTTP clients. No test makes a live network call to Greenhouse or DeepSeek.

---

## Project Structure (Overview)

```
job-harvester/
├── client/              # React + Vite frontend
│   ├── src/
│   │   ├── App.tsx          # Main app component
│   │   ├── components/      # UI components
│   │   ├── hooks/           # React hooks (SSE streaming)
│   │   └── types/           # Client-side type definitions
│   ├── index.html
│   └── vite.config.ts
├── server/              # Express + TypeScript backend
│   ├── src/
│   │   ├── server.ts            # Express app entrypoint
│   │   ├── routes/              # API route handlers
│   │   ├── pipeline/            # 5-stage pipeline modules
│   │   ├── config/              # Config loading & validation
│   │   ├── llm/                 # DeepSeek integration
│   │   ├── output/              # Persistence & dedup cache
│   │   └── types/               # Shared TypeScript interfaces
│   ├── config/companies/        # Company config files (JSON)
│   ├── profile/                 # Skills profile (JSON)
│   └── __fixtures__/            # Test fixtures
├── docs/                 # Documentation
├── .env.example          # Environment variable template
├── package.json          # Workspace root
└── SPECIFICATION.md      # Technical specification
```

For a detailed architecture description, see [`docs/architecture.md`](architecture.md).
