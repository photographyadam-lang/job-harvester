/**
 * Config validation types and error class for the Job Matching Pipeline.
 *
 * These types define the shape of company config files and skills profile
 * files loaded from disk. They are separate from the shared pipeline types
 * in `server/src/types/index.ts` because they are file-format contracts,
 * not stage data contracts.
 */

import type { JobStrength } from '../types';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown when a config file is missing, malformed, or fails validation.
 * This is a named, exported class — callers must use `instanceof` checks
 * rather than matching on a generic `Error`.
 */
export class ConfigValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

// ---------------------------------------------------------------------------
// Company config
// ---------------------------------------------------------------------------

/**
 * Schema for `config/companies/{token}.json`.
 *
 * Controls which departments are included, location and keyword filters,
 * and which section headers are searched when extracting must-have and
 * nice-to-have requirements from a job posting's HTML content.
 */
export interface CompanyConfig {
  /** Human-readable company name (e.g. "Figma"). */
  name: string;
  /**
   * Department names to include in the pipeline. Jobs not in one of these
   * departments are rejected at Stage 2.
   */
  departments: string[];
  /**
   * Desired location substring used at Stage 2 (case-insensitive match on
   * `RawJob.location.name`).  An empty string disables the location filter.
   */
  location: string;
  /**
   * Role-name keyword used at Stage 2 (case-insensitive substring match on
   * the job title).  An empty string disables the keyword filter.
   */
  keyword: string;
  /**
   * Section header keywords used during Stage 3 (requirement extraction)
   * to split a job posting's HTML into must-have and nice-to-have buckets.
   */
  sectionHeaders: {
    must_have: string[];
    nice_to_have: string[];
  };
}

// ---------------------------------------------------------------------------
// Skills profile
// ---------------------------------------------------------------------------

/**
 * A single skill entry in the skills profile.
 */
export interface SkillEntry {
  /** Skill name (e.g. "TypeScript"). */
  name: string;
  /** How strongly this skill is required. */
  strength: JobStrength;
  /**
   * Alternative names or abbreviations for this skill (e.g. ["TS", "Typescript"]).
   * Each alias is used in Stage 4 matching with the same case-insensitive
   * substring logic as `name`.  Omit or set to an empty array when a skill
   * has no aliases.
   */
  aliases?: string[];
}

/**
 * Schema for `profile/adam.json`.
 *
 * Defines the user's skills inventory and the gap threshold used at
 * Stage 4 to decide whether a job's skill gap is acceptable.
 */
export interface SkillsProfile {
  /** The user's skill inventory. */
  skills: SkillEntry[];
  /**
   * Maximum acceptable gap ratio (exclusive range 0–1).
   * A job with `gapRatio >= gapThreshold` is rejected at Stage 4.
   */
  gapThreshold: number;
}
