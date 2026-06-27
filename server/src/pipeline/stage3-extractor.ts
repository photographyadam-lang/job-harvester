/**
 * Stage 3b — Extractor
 *
 * For each FilteredJob:
 *   1. Normalize the HTML content to Markdown via `normalizeJobHtml`.
 *   2. Attempt heuristic extraction using `config.sectionHeaders`:
 *      - Look for `### heading` lines in the markdown whose text contains
 *        a known keyword (case-insensitive).
 *      - Extract bullet-point items (`* item`) under matching sections.
 *      - If BOTH must-have and nice-to-have sections are found → heuristic hit.
 *   3. If heuristic misses (one or both sections not found), fall back to
 *      DeepSeek LLM via `callDeepSeek` with the `extractionSchema`.
 *   4. On NormalizationError, LlmSchemaError, or LlmApiError: add job to
 *      rejected list and continue processing remaining jobs.
 *
 * Imports only from normalizer.ts and llm/deepseekClient.ts — never from
 * another stage module (Rule 11).
 */

import { normalizeJobHtml } from './normalizer';
import { callDeepSeek } from '../llm/deepseekClient';
import { extractionSchema } from '../llm/schemaValidator';
import { estimateCost } from '../llm/costEstimator';
import type { CompanyConfig } from '../config/types';
import type {
  FilteredJob,
  Stage3Result,
  ExtractedJob,
  RejectedJob,
} from '../types';

// ---------------------------------------------------------------------------
// Heuristic helpers
// ---------------------------------------------------------------------------

/**
 * Extract bullet-point items from a Markdown section whose `###` heading
 * matches one of the given keywords (case-insensitive substring match).
 *
 * Returns an empty array when no matching heading is found or when the
 * matching section contains no bullet items.
 */
function extractSection(markdown: string, keywords: string[]): string[] {
  // Collect all ### heading lines together with their bodies.
  // Strategy: split the markdown on ### headings.
  const lines = markdown.split('\n');
  const sections: Array<{ header: string; bodyLines: string[] }> = [];

  let currentHeader = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^###\s+(.+)/);
    if (headingMatch) {
      // Save previous section (if any)
      if (currentHeader) {
        sections.push({ header: currentHeader, bodyLines: currentBody });
      }
      currentHeader = headingMatch[1].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  // Push the final section
  if (currentHeader) {
    sections.push({ header: currentHeader, bodyLines: currentBody });
  }

  // Find the first section whose header contains any keyword (case-insensitive)
  for (const section of sections) {
    const headerLower = section.header.toLowerCase();
    const matches = keywords.some(
      (keyword) => headerLower.includes(keyword.toLowerCase()),
    );
    if (!matches) continue;

    // Extract bullet-point items
    const items: string[] = [];
    for (const bodyLine of section.bodyLines) {
      const trimmed = bodyLine.trim();
      const bulletMatch = trimmed.match(/^\*\s+(.+)/);
      if (bulletMatch) {
        items.push(bulletMatch[1].trim());
      }
    }
    return items;
  }

  return [];
}

// ---------------------------------------------------------------------------
// LLM prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the user prompt for LLM-based requirement extraction.
 */
function buildExtractionPrompt(markdown: string): string {
  return [
    'Extract the must-have requirements, nice-to-have requirements,',
    'and years of experience required from the following job description.',
    '',
    'Respond in JSON format with these fields:',
    '- must_haves: array of strings — skills or qualifications that are explicitly required',
    '- nice_to_haves: array of strings — skills or qualifications that are preferred but not required',
    '- years_experience_required: number or null — the minimum years of experience required, or null if not specified',
    '',
    'Job description:',
    markdown,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run Stage 3 (Extraction) on an array of filtered jobs.
 *
 * @param jobs        - Filtered jobs from Stage 2.
 * @param config      - Company configuration with `sectionHeaders`.
 * @param companyName - Human-readable company name (used in LLM system prompt).
 * @returns Stage3Result with passed ExtractedJobs, rejected RejectedJobs, and stats.
 */
export async function extractJobs(
  jobs: FilteredJob[],
  config: CompanyConfig,
  companyName: string,
): Promise<Stage3Result> {
  const passed: ExtractedJob[] = [];
  const rejected: RejectedJob[] = [];

  let heuristicHits = 0;
  let llmFallbacks = 0;
  let cumulativePromptTokens = 0;
  let cumulativeCompletionTokens = 0;

  for (const job of jobs) {
    // -----------------------------------------------------------------------
    // Step 1 — Normalize HTML to Markdown
    // -----------------------------------------------------------------------

    let markdown: string;
    try {
      const result = normalizeJobHtml(job.content);
      markdown = result.markdown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rejected.push({
        id: job.id,
        title: job.title,
        url: job.url,
        rejectedAtStage: 3,
        reason: `Normalization error: ${message}`,
      });
      continue;
    }

    // -----------------------------------------------------------------------
    // Step 2 — Heuristic extraction via section headers
    // -----------------------------------------------------------------------

    const mustHaves = extractSection(markdown, config.sectionHeaders.must_have);
    const niceToHaves = extractSection(
      markdown,
      config.sectionHeaders.nice_to_have,
    );

    if (mustHaves.length > 0 && niceToHaves.length > 0) {
      passed.push({
        ...job,
        requirements: { must_haves: mustHaves, nice_to_haves: niceToHaves },
      });
      heuristicHits++;
      continue;
    }

    // -----------------------------------------------------------------------
    // Step 3 — LLM fallback
    // -----------------------------------------------------------------------

    llmFallbacks++;

    try {
      const prompt = buildExtractionPrompt(markdown);
      const systemPrompt = `You are a job requirement extractor for ${companyName}. Extract structured requirements from job postings in JSON format.`;

      const response = await callDeepSeek(prompt, extractionSchema, {
        systemPrompt,
        temperature: 0,
      });

      const parsed = JSON.parse(response.content) as {
        must_haves: string[];
        nice_to_haves: string[];
      };

      cumulativePromptTokens += response.usage.promptTokens;
      cumulativeCompletionTokens += response.usage.completionTokens;

      passed.push({
        ...job,
        requirements: {
          must_haves: parsed.must_haves ?? [],
          nice_to_haves: parsed.nice_to_haves ?? [],
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rejected.push({
        id: job.id,
        title: job.title,
        url: job.url,
        rejectedAtStage: 3,
        reason: `Extraction error: ${message}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Compute aggregate stats
  // -------------------------------------------------------------------------

  const totalTokens = cumulativePromptTokens + cumulativeCompletionTokens;
  const cost = estimateCost({
    promptTokens: cumulativePromptTokens,
    completionTokens: cumulativeCompletionTokens,
  });

  return {
    passed,
    rejected,
    stats: {
      heuristicHits,
      llmFallbacks,
      llmTokensUsed: totalTokens,
      estimatedCostUsd: cost.totalCostUsd,
    },
  };
}
