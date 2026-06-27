/**
 * Skills profile loader.
 *
 * Reads and validates `profile/adam.json` from disk.
 * This is one of only two functions in the codebase that touch the
 * filesystem for config data.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigValidationError, type SkillsProfile } from './types';

/**
 * Load and validate the user's skills profile.
 *
 * @returns A validated `SkillsProfile` object.
 * @throws {ConfigValidationError} If the file is missing, unreadable,
 *   or fails schema validation.
 */
export function loadSkillsProfile(): SkillsProfile {
  const filePath = path.resolve(process.cwd(), 'profile', 'adam.json');

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (_err) {
    throw new ConfigValidationError(
      `Skills profile file not found: ${filePath}`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ConfigValidationError(
      `Skills profile file is not valid JSON: ${filePath}`,
    );
  }

  // --- skills ---
  if (parsed.skills === undefined || parsed.skills === null) {
    throw new ConfigValidationError(
      `Missing required field "skills" in skills profile: ${filePath}`,
    );
  }
  if (!Array.isArray(parsed.skills)) {
    throw new ConfigValidationError(
      `Field "skills" must be an array in skills profile: ${filePath}`,
    );
  }
  if (parsed.skills.length === 0) {
    throw new ConfigValidationError(
      `Field "skills" must not be empty in skills profile: ${filePath}`,
    );
  }

  // validate each skill entry
  const skills = parsed.skills as Record<string, unknown>[];
  for (let i = 0; i < skills.length; i++) {
    const entry = skills[i];
    if (typeof entry.name !== 'string') {
      throw new ConfigValidationError(
        `Field "skills[${i}].name" must be a string in skills profile: ${filePath}`,
      );
    }
    if (
      typeof entry.strength !== 'string' ||
      !['must_have', 'nice_to_have', 'preferred'].includes(
        entry.strength as string,
      )
    ) {
      throw new ConfigValidationError(
        `Field "skills[${i}].strength" must be one of "must_have", "nice_to_have", or "preferred" in skills profile: ${filePath}`,
      );
    }
    // validate aliases if present
    if (entry.aliases !== undefined && entry.aliases !== null) {
      if (!Array.isArray(entry.aliases)) {
        throw new ConfigValidationError(
          `Field "skills[${i}].aliases" must be an array in skills profile: ${filePath}`,
        );
      }
      for (let j = 0; j < (entry.aliases as unknown[]).length; j++) {
        if (typeof (entry.aliases as unknown[])[j] !== 'string') {
          throw new ConfigValidationError(
            `Field "skills[${i}].aliases[${j}]" must be a string in skills profile: ${filePath}`,
          );
        }
      }
    }
  }

  // --- gapThreshold ---
  if (parsed.gapThreshold === undefined || parsed.gapThreshold === null) {
    throw new ConfigValidationError(
      `Missing required field "gapThreshold" in skills profile: ${filePath}`,
    );
  }
  if (typeof parsed.gapThreshold !== 'number') {
    throw new ConfigValidationError(
      `Field "gapThreshold" must be a number in skills profile: ${filePath}`,
    );
  }
  const gapThreshold = parsed.gapThreshold as number;
  if (gapThreshold <= 0 || gapThreshold >= 1) {
    throw new ConfigValidationError(
      `Field "gapThreshold" must be in range 0-1 (exclusive) in skills profile: ${filePath}`,
    );
  }

  return {
    skills: skills.map((s) => ({
      name: s.name as string,
      strength: s.strength as 'must_have' | 'nice_to_have' | 'preferred',
      ...(Array.isArray(s.aliases) && s.aliases.length > 0
        ? { aliases: s.aliases as string[] }
        : {}),
    })),
    gapThreshold,
  };
}
