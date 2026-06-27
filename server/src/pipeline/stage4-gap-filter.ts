/**
 * Stage 4 — Gap Filter
 *
 * Compares each job's must-have requirements against the user's skills profile
 * and rejects jobs whose gap ratio (fraction of unmatched must-haves) meets or
 * exceeds the configured threshold.
 *
 * This module is pure: no I/O, no LLM calls, no network, no side effects.
 */

import type { ExtractedJob, GatedJob, StageResult, RejectedJob } from '../types';
import type { SkillsProfile } from '../config/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A minimal skill-like object accepted by `matchSkill` and `computeGapRatio`.
 *
 * Both `SkillEntry` (from the config profile) and inline test objects with
 * `aliases` are assignable to this interface.
 */
interface SkillLike {
  name: string;
  aliases?: string[];
  strength?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a single requirement string matches a skill entry.
 *
 * Matching is case-insensitive substring against the skill's `name` and all
 * of its `aliases`. The skill's `strength` level is irrelevant — any strength
 * is a full match.
 *
 * @param requirement - A requirement string (e.g. from a job posting).
 * @param skill       - A skill entry with a `name` and optional `aliases`.
 * @returns `true` if the requirement matches the skill by name or alias.
 */
export function matchSkill(requirement: string, skill: SkillLike): boolean {
  const lowerReq = requirement.toLowerCase();

  // Check the skill name itself
  if (skill.name.toLowerCase().includes(lowerReq) || lowerReq.includes(skill.name.toLowerCase())) {
    return true;
  }

  // Check each alias
  if (skill.aliases) {
    for (const alias of skill.aliases) {
      const lowerAlias = alias.toLowerCase();
      if (lowerAlias.includes(lowerReq) || lowerReq.includes(lowerAlias)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Compute the gap ratio for a set of must-have requirements against a list of
 * skills. The gap ratio is the fraction of must-haves that are not matched by
 * any skill in the profile.
 *
 * A job with zero must-haves always has a gap ratio of 0.
 *
 * @param mustHaves - The must-have requirement strings from a job posting.
 * @param skills    - The user's skill inventory (from the skills profile).
 * @returns A number in [0, 1] representing the unmatched fraction.
 */
export function computeGapRatio(
  mustHaves: string[],
  skills: SkillLike[],
): number {
  if (mustHaves.length === 0) {
    return 0;
  }

  let unmatchedCount = 0;

  for (const req of mustHaves) {
    const matched = skills.some((skill) => matchSkill(req, skill));
    if (!matched) {
      unmatchedCount++;
    }
  }

  return unmatchedCount / mustHaves.length;
}

/**
 * Filter an array of extracted jobs by computing the gap ratio for each job's
 * must-have requirements against the user's skills profile.
 *
 * Jobs with `gapRatio >= profile.gapThreshold` are rejected at stage 4.
 * Jobs with `gapRatio < profile.gapThreshold` pass and are returned as
 * `GatedJob` objects containing the computed gap data.
 *
 * @param jobs    - Extracted jobs from Stage 3.
 * @param profile - The user's skills profile (skills + gapThreshold).
 * @returns A `StageResult<GatedJob>` with passed and rejected arrays.
 */
export function filterByGap(
  jobs: ExtractedJob[],
  profile: SkillsProfile,
): StageResult<GatedJob> {
  const passed: GatedJob[] = [];
  const rejected: RejectedJob[] = [];

  for (const job of jobs) {
    const mustHaves = job.requirements.must_haves;
    const skills = profile.skills;

    const gapRatio = computeGapRatio(mustHaves, skills);

    // Determine which skills matched and which did not
    const matchedSkills: string[] = [];
    const unmatchedSkills: string[] = [];

    for (const req of mustHaves) {
      const matched = skills.some((skill) => matchSkill(req, skill));
      if (matched) {
        matchedSkills.push(req);
      } else {
        unmatchedSkills.push(req);
      }
    }

    if (gapRatio >= profile.gapThreshold) {
      const reason =
        unmatchedSkills.length > 0
          ? `Rejected by gap filter: gapRatio=${gapRatio} meets/exceeds threshold=${profile.gapThreshold}. Unmatched must-haves: ${unmatchedSkills.join(', ')}`
          : `Rejected by gap filter: gapRatio=${gapRatio} meets/exceeds threshold=${profile.gapThreshold}`;

      rejected.push({
        id: job.id,
        title: job.title,
        url: job.url,
        rejectedAtStage: 4,
        reason,
      });
    } else {
      passed.push({
        ...job,
        gapRatio,
        matchedSkills,
        unmatchedSkills,
      });
    }
  }

  return { passed, rejected };
}
