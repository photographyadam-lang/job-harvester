# Job Harvester — User Guide

> How to configure and use the Job Harvester pipeline for finding relevant jobs.

---

## 1. Overview

The Job Harvester runs a 5-stage pipeline against a company's Greenhouse job board. The pipeline fetches jobs, filters by department/location/keyword, extracts must-have and nice-to-have requirements from job descriptions, compares your skills against those requirements (Stage 4 Gap Filter), and scores the remaining jobs using AI.

This guide focuses on **Stage 4 — Gap Filter**: how to set up your skills profile so the pipeline correctly matches (or rejects) jobs based on your actual skill set.

---

## 2. What Stage 4 Does

Stage 4 compares each job's **must-have** requirements (extracted in Stage 3) against your **skills profile**. It computes a **gap ratio** — the fraction of must-have requirements you don't possess — and rejects any job whose gap ratio meets or exceeds your configured **gap threshold**.

- **Jobs with a low gap ratio** (you have most of the required skills) pass through to Stage 5 for scoring.
- **Jobs with a high gap ratio** (you lack too many must-have skills) are rejected with a reason listing the unmatched requirements.

Stage 4 is a **pure computation** — it makes no API calls, costs nothing, and runs instantly.

---

## 3. Where Configuration Lives

Your skills profile is stored in [`server/profile/adam.json`](../server/profile/adam.json). This is the file you edit to configure the gap filter.

The profile has two top-level fields:

| Field | Type | Description |
|---|---|---|
| `skills` | `SkillEntry[]` | Your skill inventory — the list of skills the pipeline will try to match against job requirements. |
| `gapThreshold` | `number` (0–1) | Maximum acceptable gap ratio. A job with `gapRatio >= gapThreshold` is rejected. |

---

## 4. The `skills` Array

Each entry in the `skills` array is an object with these fields:

```json
{
  "name": "TypeScript",
  "aliases": ["TS", "Typescript"],
  "strength": "must_have"
}
```

### 4.1 `name` (required, string)

The canonical name of the skill. Matching is **case-insensitive substring** — both `"TypeScript".includes("typescript")` and `"typescript".includes("TypeScript")` count as a match.

**Examples:**

| Requirement from job | Skill `name` | Match? |
|---|---|---|
| `"TypeScript"` | `"TypeScript"` | ✅ Exact |
| `"typescript"` | `"TypeScript"` | ✅ Case-insensitive |
| `"Type"` | `"TypeScript"` | ✅ Substring |
| `"Machine Learning"` | `"Learning"` | ✅ Substring |
| `"Python"` | `"TypeScript"` | ❌ No overlap |

**Tip:** Choose skill names that are specific enough to avoid false positives. `"Python"` is good; `"script"` would match too many unrelated requirements.

### 4.2 `aliases` (optional, string[])

Alternative names or abbreviations for the skill. Each alias is matched with the same case-insensitive substring logic as `name`.

**Example:**

```json
{
  "name": "Amazon Web Services",
  "aliases": ["AWS", "aws", "Amazon Cloud"]
}
```

This skill would match requirements like `"AWS"`, `"Amazon Web Services"`, `"aws lambda"`, `"Amazon Cloud Platform"`, etc.

**Tip:** Use aliases for common abbreviations (`"JS"` for `"JavaScript"`), alternate spellings (`"Typescript"` for `"TypeScript"`), or related terms that employers might use.

### 4.3 `strength` (required, string)

One of `"must_have"`, `"nice_to_have"`, or `"preferred"`.

**Important:** The `strength` field is **informational** — it does **not** affect matching in Stage 4. A skill with `"strength": "preferred"` counts as a full match just like `"strength": "must_have"`. The strength is visible in later stages (Stage 5 scoring) and helps you organize your profile, but it has no effect on the gap ratio calculation.

### 4.4 LLM-Powered Alias Suggestions

The Config Editor UI has a **Suggest** button next to each skill's aliases field. Clicking it sends the skill name to an AI model (DeepSeek) which returns a list of common alternative names, abbreviations, and related terms that employers might use in job postings.

**How it works:**

1. Enter a skill name (e.g. `"Kubernetes"`).
2. Click the **Suggest** button.
3. The AI returns aliases like `["K8s", "k8s", "Kube"]`.
4. The aliases field is autopopulated — you can edit the list before saving.

**Cost:** Each suggestion is a single LLM call (approximately $0.0001–$0.001 USD). The button is manually triggered — suggestions never run automatically.

**Tip:** Always review suggested aliases before saving. The AI may occasionally suggest terms that are too broad or not actually relevant.

---

## 5. The `gapThreshold` Field

A number between `0` and `1` that controls how strict the gap filter is.

### 5.1 How `gapRatio` Is Calculated

For each job, the pipeline:

1. Takes all `must_have` requirements extracted from the job posting.
2. Checks each requirement against your entire skills list (names + aliases).
3. Counts how many requirements are **not matched** by any skill.
4. Computes: `gapRatio = unmatchedCount / totalMustHaves`

A job with **zero** must-have requirements always has a `gapRatio` of `0` and always passes.

### 5.2 Threshold Comparison

```
If gapRatio >= gapThreshold  →  Job is REJECTED
If gapRatio <  gapThreshold  →  Job PASSES to Stage 5
```

The rejection is **inclusive** at the threshold. If `gapThreshold` is `0.5` and the job's `gapRatio` is exactly `0.5`, the job is rejected.

### 5.3 Threshold Examples

**Example:** Your profile has skills `["TypeScript", "React", "Node.js", "PostgreSQL"]`.

| Job must-haves | Unmatched | gapRatio | threshold=0.3 | threshold=0.5 | threshold=0.8 |
|---|---|---|---|---|---|
| `["TypeScript", "React"]` | 0 | 0.00 | ✅ Pass | ✅ Pass | ✅ Pass |
| `["TypeScript", "Python"]` | 1 | 0.50 | ❌ Reject | ❌ Reject | ✅ Pass |
| `["TypeScript", "Python", "Go", "Rust"]` | 3 | 0.75 | ❌ Reject | ❌ Reject | ✅ Pass |
| `["Python", "Go", "Rust"]` | 3 | 1.00 | ❌ Reject | ❌ Reject | ❌ Reject |

### 5.4 Understanding the Threshold as Match Percentage

Since `gapThreshold` measures the fraction of must-haves you **lack**, the inverse tells you how many must-haves you **must match** to pass:

```
minimumMatchFraction = 1 - gapThreshold
```

A job passes when your match fraction is **strictly greater** than `1 - gapThreshold`.

| gapThreshold | Minimum match % to pass | Behavior |
|---|---|---|
| `0.2` | **>80%** | Very strict — you must match almost all must-haves |
| `0.4` | **>60%** | Strict — you must match most must-haves |
| `0.5` | **>50%** | Moderate — match at least half the must-haves |
| `0.8` | **>20%** | Lenient — match just 1 in 5 must-haves |
| `0.9` | **>10%** | Very lenient — almost all jobs pass |

### 5.5 Choosing a Threshold

| Threshold | Match needed | Behavior | When to use |
|---|---|---|---|
| `0.0` | >100% | Rejects every job (any gap at all) | Almost never — you'd need a perfect match for every must-have |
| `0.2`–`0.4` | >80%–>60% | Very strict — most jobs need most skills | When you want only roles where you meet nearly all requirements |
| `0.5`–`0.7` | >50%–>30% | Moderate — allows some gaps | When you're open to roles where you meet about half the requirements |
| `0.8`–`0.9` | >20%–>10% | Lenient — allows many gaps | When you want to see a broad range of roles, even if you lack many skills |
| `1.0` | >0% | Never rejects (gapRatio is always ≤ 1) | When you want Stage 4 to effectively do nothing — all jobs pass |

**Recommendation:** Start with `0.5` (match >50% of must-haves) and adjust based on your results. If too many irrelevant jobs pass, lower the threshold. If good jobs are being rejected, raise it.

---

## 6. Complete Profile Example

Here is a realistic skills profile:

```json
{
  "skills": [
    {
      "name": "TypeScript",
      "aliases": ["TS", "Typescript"],
      "strength": "must_have"
    },
    {
      "name": "React",
      "aliases": ["React.js", "ReactJS"],
      "strength": "must_have"
    },
    {
      "name": "Node.js",
      "aliases": ["Node", "NodeJS", "Node.js"],
      "strength": "must_have"
    },
    {
      "name": "PostgreSQL",
      "aliases": ["Postgres", "PSQL"],
      "strength": "nice_to_have"
    },
    {
      "name": "Docker",
      "aliases": [],
      "strength": "nice_to_have"
    },
    {
      "name": "AWS",
      "aliases": ["Amazon Web Services", "Amazon AWS"],
      "strength": "preferred"
    },
    {
      "name": "GraphQL",
      "aliases": [],
      "strength": "nice_to_have"
    }
  ],
  "gapThreshold": 0.5
}
```

With this profile:

- A job requiring `["TypeScript", "React", "Node.js"]` has `gapRatio = 0` → ✅ passes.
- A job requiring `["TypeScript", "React", "Python"]` has `gapRatio ≈ 0.33` → ✅ passes (below 0.5).
- A job requiring `["TypeScript", "Python", "Go"]` has `gapRatio ≈ 0.67` → ❌ rejected (above 0.5).
- A job requiring `["Kubernetes", "Terraform", "Python"]` has `gapRatio = 1.0` → ❌ rejected.

---

## 7. How to Edit Your Profile

### Via the UI (Config Editor)

1. Start the Job Harvester (both server and client).
2. In the web UI, use the **Config Editor** panel to view and edit both the company config and your skills profile.
3. Each skill row has a **Suggest** button that uses AI to autopopulate aliases — click it, review the suggestions, and save.
4. Changes are saved via the PUT endpoints and validated by the server — invalid configs are rejected with an inline error message.

### Via Direct File Editing

1. Open [`server/profile/adam.json`](../server/profile/adam.json) in any text editor.
2. Add, remove, or modify skill entries in the `skills` array.
3. Adjust `gapThreshold` as desired.
4. Save the file. The next pipeline run will use the updated profile.

### Validation Rules

The server validates your profile on load. The following will cause a `ConfigValidationError`:

- Missing required fields (`skills`, `gapThreshold`, or a skill's `name` and `strength`)
- `gapThreshold` not a number, or outside the range 0–1
- `strength` not one of `"must_have"`, `"nice_to_have"`, or `"preferred"`
- `skills` not an array

---

## 8. Tips for Effective Filtering

### 8.1 Be Specific with Skill Names

- ✅ `"Machine Learning"` — specific enough to avoid matching unrelated text.
- ❌ `"data"` — too generic; would match almost any job posting.

### 8.2 Use Aliases Liberally

Job postings use varied terminology. A role might ask for "K8s" instead of "Kubernetes", or "CI/CD" instead of "Continuous Integration". Add common variants as aliases.

### 8.3 Review Rejected Jobs

When a job is rejected at Stage 4, the rejection reason lists the unmatched must-have requirements. Use this feedback to:

- Add missing skills to your profile (if you actually have them but used a different name).
- Add aliases for terms you didn't anticipate.
- Adjust your `gapThreshold` if you're consistently seeing good jobs rejected.

### 8.4 Iterate on Your Threshold

Run the pipeline, review the results, and adjust `gapThreshold`:

1. Run with `gapThreshold: 0.5`.
2. Check the Stage 4 panel — see how many jobs passed vs. were rejected.
3. Look at the unmatched skills on passing jobs (visible in the UI).
4. If you see jobs you'd consider applying to being rejected, raise the threshold to `0.6` or `0.7`.
5. If you see too many irrelevant jobs passing, lower it to `0.3` or `0.4`.

### 8.5 Remember: Only Must-Haves Matter

Stage 4 only considers `must_have` requirements extracted from the job posting. `nice_to_have` requirements are **not** used in the gap calculation. The gap ratio is purely: _"How many of the non-negotiable requirements do I meet?"_

---

## 9. How Stage 4 Fits in the Full Pipeline

```
Stage 1: Fetch        →  Get all jobs from Greenhouse
Stage 2: Filter       →  Keep only matching department/location/keyword
Stage 3: Extract      →  Pull out must-have & nice-to-have requirements
Stage 4: Gap Filter   →  Compare requirements against YOUR skills (this guide)
Stage 5: Score        →  AI scores remaining jobs 1–10
```

Stage 4 sits between extraction and scoring. It acts as a **quality gate**: only jobs where your skill gap is acceptable reach the (paid) AI scoring stage.

---

## 10. Troubleshooting

| Problem | Likely Cause | Fix |
|---|---|---|
| All jobs rejected at Stage 4 | `gapThreshold` too low | Raise `gapThreshold` to `0.7` or higher |
| No jobs rejected at Stage 4 | `gapThreshold` too high, or no must-haves extracted | Lower `gapThreshold`; check Stage 3 extraction results |
| A skill you have isn't matching | Name mismatch | Add aliases for alternate terms used in job postings |
| A skill is matching too broadly | Skill name too generic | Use a more specific name (e.g., `"React.js"` instead of `"JS"`) |
| Config validation error on load | Malformed `adam.json` | Check JSON syntax; ensure all required fields are present |
| Suggest Aliases fails | `DEEPSEEK_API_KEY` not set, or API error | Verify `.env` has a valid key; check server logs for detail |
