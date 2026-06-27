/**
 * Stage 5 — Scorer
 *
 * For each GatedJob, sends a structured prompt to DeepSeek requesting a 1–10
 * score and one sentence of reasoning. Returns scored jobs sorted descending
 * by score, any jobs that failed LLM validation, and scoring statistics.
 *
 * The prompt template is owned here and nowhere else.
 */

import { callDeepSeek } from '../llm/deepseekClient';
import { scoreSchema } from '../llm/schemaValidator';
import { estimateCost } from '../llm/costEstimator';
import type { SkillsProfile } from '../config/types';
import type {
  GatedJob,
  Stage5Result,
  ScoredJob,
  RejectedJob,
} from '../types';

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the scoring prompt for a single job.
 *
 * Includes the job title, department, location, extracted requirements, gap
 * analysis results, and the user's skills profile so DeepSeek can evaluate
 * the overall match quality.
 */
function buildScoringPrompt(job: GatedJob, profile: SkillsProfile): string {
  const skillsList = profile.skills
    .map((s) => `  - ${s.name} (${s.strength})`)
    .join('\n');

  return [
    'You are a job-match scoring assistant. Evaluate how well the following',
    'job posting matches the candidate\'s skills profile.',
    '',
    '--- JOB DETAILS ---',
    `Title: ${job.title}`,
    `Department: ${job.department}`,
    `Location: ${job.location}`,
    '',
    '--- EXTRACTED REQUIREMENTS ---',
    `Must-haves: ${job.requirements.must_haves.join(', ') || '(none)'}`,
    `Nice-to-haves: ${job.requirements.nice_to_haves.join(', ') || '(none)'}`,
    '',
    '--- GAP ANALYSIS ---',
    `Gap ratio: ${job.gapRatio}`,
    `Matched skills: ${job.matchedSkills.join(', ') || '(none)'}`,
    `Unmatched skills: ${job.unmatchedSkills.join(', ') || '(none)'}`,
    '',
    '--- CANDIDATE SKILLS PROFILE ---',
    skillsList,
    '',
    '--- INSTRUCTION ---',
    'Score this job on a scale of 1–10 based on how well the candidate\'s',
    'skills match the job requirements. Consider must-have alignment as the',
    'most important factor, followed by nice-to-haves. A lower gap ratio',
    'should generally lead to a higher score.',
    '',
    'Respond in JSON format with exactly these fields:',
    '- score: number 1–10 — the overall match score',
    '- scoreReasoning: string — one sentence explaining the score',
    '',
    'JSON response:',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run Stage 5 (Scoring) on an array of gated jobs.
 *
 * @param jobs    - Gated jobs from Stage 4.
 * @param profile - The user's skills profile.
 * @returns Stage5Result with scoredJobs sorted descending, rejected jobs, and stats.
 */
export async function scoreJobs(
  jobs: GatedJob[],
  profile: SkillsProfile,
): Promise<Stage5Result> {
  const scoredJobs: ScoredJob[] = [];
  const rejected: RejectedJob[] = [];

  let cumulativePromptTokens = 0;
  let cumulativeCompletionTokens = 0;
  let totalLlmCalls = 0;

  for (const job of jobs) {
    const prompt = buildScoringPrompt(job, profile);
    totalLlmCalls++;

    try {
      const response = await callDeepSeek(prompt, scoreSchema, {
        temperature: 0,
        systemPrompt:
          'You are a job-match scoring assistant. Always respond with valid JSON matching the requested schema.',
      });

      const parsed = JSON.parse(response.content) as {
        score: number;
        scoreReasoning: string;
      };

      cumulativePromptTokens += response.usage.promptTokens;
      cumulativeCompletionTokens += response.usage.completionTokens;

      scoredJobs.push({
        ...job,
        score: parsed.score,
        scoreReasoning: parsed.scoreReasoning,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rejected.push({
        id: job.id,
        title: job.title,
        url: job.url,
        rejectedAtStage: 5,
        reason: `Scoring error: ${message}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Sort scored jobs by score descending
  // -------------------------------------------------------------------------

  scoredJobs.sort((a, b) => b.score - a.score);

  // -------------------------------------------------------------------------
  // Compute aggregate stats
  // -------------------------------------------------------------------------

  const totalTokens = cumulativePromptTokens + cumulativeCompletionTokens;
  const cost = estimateCost({
    promptTokens: cumulativePromptTokens,
    completionTokens: cumulativeCompletionTokens,
  });

  return {
    scoredJobs,
    rejected,
    stats: {
      totalJobsScored: scoredJobs.length,
      totalJobsRejected: rejected.length,
      totalLlmCalls,
      llmTokensUsed: totalTokens,
      estimatedCostUsd: cost.totalCostUsd,
    },
  };
}
