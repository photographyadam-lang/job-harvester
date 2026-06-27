/**
 * Company config loader.
 *
 * Reads and validates `config/companies/{token}.json` from disk.
 * This is one of only two functions in the codebase that touch the
 * filesystem for config data.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigValidationError, type CompanyConfig } from './types';

/**
 * Helper: validate that a value at `fieldPath` is a non-null string.
 */
function assertString(
  value: unknown,
  fieldPath: string,
  filePath: string,
): asserts value is string {
  if (value === undefined || value === null) {
    throw new ConfigValidationError(
      `Missing required field "${fieldPath}" in company config: ${filePath}`,
    );
  }
  if (typeof value !== 'string') {
    throw new ConfigValidationError(
      `Field "${fieldPath}" must be a string in company config: ${filePath}`,
    );
  }
}

/**
 * Load and validate a company configuration file.
 *
 * @param token - Company identifier used as the filename stem
 *   (e.g. `'figma'` → `config/companies/figma.json`).
 * @returns A validated `CompanyConfig` object.
 * @throws {ConfigValidationError} If the file is missing, unreadable,
 *   or fails schema validation.
 */
export function loadCompanyConfig(token: string): CompanyConfig {
  const filePath = path.resolve(
    process.cwd(),
    'config',
    'companies',
    `${token}.json`,
  );

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (_err) {
    throw new ConfigValidationError(
      `Company config file not found: ${filePath}`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ConfigValidationError(
      `Company config file is not valid JSON: ${filePath}`,
    );
  }

  // --- name ---
  assertString(parsed.name, 'name', filePath);

  // --- departments ---
  if (parsed.departments === undefined || parsed.departments === null) {
    throw new ConfigValidationError(
      `Missing required field "departments" in company config: ${filePath}`,
    );
  }
  if (!Array.isArray(parsed.departments)) {
    throw new ConfigValidationError(
      `Field "departments" must be an array in company config: ${filePath}`,
    );
  }
  if (parsed.departments.length === 0) {
    throw new ConfigValidationError(
      `Field "departments" must not be empty in company config: ${filePath}`,
    );
  }

  // --- location (optional; defaults to empty string) ---
  const location =
    typeof parsed.location === 'string' ? parsed.location : '';

  // --- keyword (optional; defaults to empty string) ---
  const keyword =
    typeof parsed.keyword === 'string' ? parsed.keyword : '';

  // --- sectionHeaders ---
  if (parsed.sectionHeaders === undefined || parsed.sectionHeaders === null) {
    throw new ConfigValidationError(
      `Missing required field "sectionHeaders" in company config: ${filePath}`,
    );
  }
  const sectionHeaders = parsed.sectionHeaders as Record<string, unknown>;

  if (
    sectionHeaders.must_have === undefined ||
    sectionHeaders.must_have === null
  ) {
    throw new ConfigValidationError(
      `Missing required field "sectionHeaders.must_have" in company config: ${filePath}`,
    );
  }

  if (
    sectionHeaders.nice_to_have === undefined ||
    sectionHeaders.nice_to_have === null
  ) {
    throw new ConfigValidationError(
      `Missing required field "sectionHeaders.nice_to_have" in company config: ${filePath}`,
    );
  }

  return {
    name: parsed.name as string,
    departments: parsed.departments as string[],
    location,
    keyword,
    sectionHeaders: {
      must_have: sectionHeaders.must_have as string[],
      nice_to_have: sectionHeaders.nice_to_have as string[],
    },
  };
}
