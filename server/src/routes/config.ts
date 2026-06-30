/**
 * Config read/write routes.
 *
 * - GET  /api/companies                      — list available company tokens
 * - GET  /api/config/company/:token          — load a company config
 * - PUT  /api/config/company/:token          — write a company config (validated)
 * - GET  /api/config/profile                 — load the skills profile
 * - PUT  /api/config/profile                 — write the skills profile (validated)
 * - POST /api/config/profile/suggest-aliases — suggest aliases for a skill (LLM)
 *
 * This file contains no business logic. It calls config loaders, the DeepSeek
 * client, and the filesystem and relays results only.
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { loadCompanyConfig, resolveBoardToken } from '../config/companyConfig';
import { loadSkillsProfile } from '../config/skillsProfile';
import { ConfigValidationError } from '../config/types';
import { callDeepSeek, LlmApiError, LlmSchemaError } from '../llm/deepseekClient';
import { fetchJobs, FetchError } from '../pipeline/stage1-fetch';
import type { FrequencyItem } from '../types';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the directory that holds company config files.
 * Matches the convention used in `companyConfig.ts`:
 *   process.cwd() / config / companies
 */
function companiesDir(): string {
  return path.resolve(process.cwd(), 'config', 'companies');
}

/**
 * Resolve the profile directory (same convention as `skillsProfile.ts`).
 */
function profileDir(): string {
  return path.resolve(process.cwd(), 'profile');
}

/**
 * Map a validation error to a 400 response.
 */
function handleValidationError(err: unknown, res: Response): void {
  if (err instanceof ConfigValidationError) {
    res.status(400).json({ error: 'Validation failed', detail: err.message });
  } else {
    throw err; // rethrow unexpected errors
  }
}

// ---------------------------------------------------------------------------
// GET /api/companies
// ---------------------------------------------------------------------------

router.get('/companies', (_req: Request, res: Response) => {
  const dir = companiesDir();

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    // Directory does not exist yet — return empty list
    res.json([]);
    return;
  }

  const tokens = entries
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));

  res.json(tokens);
});

// ---------------------------------------------------------------------------
// GET /api/config/company/:token
// ---------------------------------------------------------------------------

router.get('/config/company/:token', (req: Request, res: Response) => {
  const token = req.params.token as string;

  try {
    const config = loadCompanyConfig(token);
    res.json(config);
  } catch (err) {
    handleValidationError(err, res);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/config/company/:token
//
// Strategy: write the incoming JSON to disk, then validate by loading via
// the config loader. If validation fails, restore the previous file content
// and return 400.
// ---------------------------------------------------------------------------

router.put('/config/company/:token', (req: Request, res: Response) => {
  const token = req.params.token as string;
  const filePath = path.resolve(companiesDir(), `${token}.json`);

  try {
    // Ensure target directory exists
    fs.mkdirSync(companiesDir(), { recursive: true });

    // Read the existing content as a backup (may not exist yet)
    let backup: string | null = null;
    try {
      backup = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // No existing file — that's fine
    }

    // Write the incoming JSON to the actual file path
    const raw = JSON.stringify(req.body, null, 2);
    fs.writeFileSync(filePath, raw, 'utf-8');

    // Validate by loading — throws ConfigValidationError on failure
    try {
      loadCompanyConfig(token);
    } catch (validateErr) {
      // Validation failed — restore backup if available, otherwise delete
      if (backup !== null) {
        fs.writeFileSync(filePath, backup, 'utf-8');
      } else {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Best-effort cleanup
        }
      }
      handleValidationError(validateErr, res);
      return;
    }

    // Return the validated config
    const config = loadCompanyConfig(token);
    res.json(config);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      handleValidationError(err, res);
    } else {
      res.status(500).json({ error: 'Internal server error', detail: String(err) });
    }
  }
});

// ---------------------------------------------------------------------------
// GET /api/config/profile
// ---------------------------------------------------------------------------

router.get('/config/profile', (_req: Request, res: Response) => {
  try {
    const profile = loadSkillsProfile();
    res.json(profile);
  } catch (err) {
    handleValidationError(err, res);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/config/profile
// ---------------------------------------------------------------------------

router.put('/config/profile', (req: Request, res: Response) => {
  const filePath = path.resolve(profileDir(), 'adam.json');

  try {
    fs.mkdirSync(profileDir(), { recursive: true });

    // Read the existing content as a backup
    let backup: string | null = null;
    try {
      backup = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // No existing file — that's fine
    }

    // Write the incoming JSON to the actual file path
    const raw = JSON.stringify(req.body, null, 2);
    fs.writeFileSync(filePath, raw, 'utf-8');

    // Validate
    try {
      loadSkillsProfile();
    } catch (validateErr) {
      // Validation failed — restore backup
      if (backup !== null) {
        fs.writeFileSync(filePath, backup, 'utf-8');
      } else {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Best-effort cleanup
        }
      }
      handleValidationError(validateErr, res);
      return;
    }

    const profile = loadSkillsProfile();
    res.json(profile);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      handleValidationError(err, res);
    } else {
      res.status(500).json({ error: 'Internal server error', detail: String(err) });
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/config/profile/suggest-aliases
//
// Calls DeepSeek to suggest common alternative names, abbreviations, and
// related terms for a given skill.  The user initiates this per-skill from
// the ConfigEditor UI.
// ---------------------------------------------------------------------------

router.post('/config/profile/suggest-aliases', async (req: Request, res: Response) => {
  try {
    const { skillName } = req.body as { skillName?: string };

    if (!skillName || typeof skillName !== 'string' || skillName.trim().length === 0) {
      res.status(400).json({ error: 'Validation failed', detail: 'Field "skillName" is required and must be a non-empty string.' });
      return;
    }

    const prompt = [
      `List common alternative names, abbreviations, and related terms for the technical skill "${skillName.trim()}".`,
      'Include:',
      '- Common abbreviations (e.g. "JS" for "JavaScript")',
      '- Alternate spellings or capitalizations',
      '- Closely related or synonymous terms that employers might use in job postings',
      '',
      'Do NOT include the original skill name itself.',
      'Return ONLY a JSON object with an "aliases" array of strings, e.g. {"aliases":["TS","Typescript"]}.',
      'If no reasonable aliases exist, return {"aliases":[]}.',
      'Limit to at most 8 aliases.',
    ].join('\n');

    const schema = {
      type: 'object' as const,
      properties: {
        aliases: { type: 'array' as const, items: { type: 'string' as const } },
      },
      required: ['aliases'],
    };

    const response = await callDeepSeek(prompt, schema, {
      temperature: 0.2,
    });

    const parsed = JSON.parse(response.content) as { aliases: string[] };
    res.json({ aliases: parsed.aliases });
  } catch (err) {
    if (err instanceof LlmApiError) {
      res.status(502).json({ error: 'LLM API error', detail: err.message });
    } else if (err instanceof LlmSchemaError) {
      res.status(502).json({ error: 'LLM response validation failed', detail: err.message });
    } else {
      res.status(500).json({ error: 'Internal server error', detail: String(err) });
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/config/company/:token/suggest-keywords
//
// Fetches all job titles for the company from Greenhouse and sends them to
// DeepSeek to decompose each title into two components:
//   1. roles         — generic role/level descriptions (e.g. "Software Engineer")
//   2. specializations — domain / functional specialty (e.g. "Machine Learning")
// Both lists are deduplicated and returned separately so the ConfigEditor UI
// can present them as grouped suggestions in a datalist dropdown.
// ---------------------------------------------------------------------------

router.post(
  '/config/company/:token/suggest-keywords',
  async (req: Request, res: Response) => {
    const { token } = req.params;

    try {
      // 0. Resolve the effective Greenhouse board token.
      //    If the company config file exists, use its boardToken field (or fall
      //    back to the token).  If the config file doesn't exist yet, use the
      //    raw token.
      let boardToken = token as string;
      try {
        const companyConfig = loadCompanyConfig(token as string);
        boardToken = resolveBoardToken(companyConfig, token as string);
      } catch {
        // Config file doesn't exist — use raw token as board token
      }

      // 1. Fetch all job titles for the company
      const { jobs } = await fetchJobs(boardToken);

      // 2. Extract deduplicated, sorted job titles
      const titles = [...new Set(jobs.map((j) => j.title))].sort();

      // 3. Build the prompt — decompose titles into roles + specializations
      const prompt = [
        'Given the following list of job titles from a company\'s careers page, decompose each title into two components and return them as separate, deduplicated lists.',
        '',
        '1. ROLES: The generic role or level description — the part that describes the job function independent of domain.',
        '   Examples: "Software Engineer", "Manager", "Director", "Head", "Lead", "Partner", "Specialist", "Analyst", "Project Manager", "Associate", "Consultant", "Designer", "Scientist", "Architect", "Developer", "Administrator", "Coordinator", "Recruiter", "Representative".',
        '   Include seniority modifiers when they are part of the role (e.g. "Senior Software Engineer", "Junior Analyst", "Staff Engineer").',
        '   Deduplicate this list — return each unique role once, sorted alphabetically.',
        '',
        '2. SPECIALIZATIONS: The domain or functional specialty — the part that describes what area the role focuses on.',
        '   Examples: "Machine Learning", "Security Operations", "Product Design", "Data Engineering", "Revenue Operations", "Infrastructure", "Privacy", "Mid-Market Sales".',
        '   DO NOT include generic role-level words here (those belong in the ROLES list).',
        '   DO NOT include company names or location-based terms.',
        '   Each specialization should be 1-4 words long.',
        '   Deduplicate this list — return each unique specialization once, sorted alphabetically.',
        '',
        'Job titles:',
        ...titles.map((t) => `- ${t}`),
        '',
        'Return ONLY a JSON object with "roles" and "specializations" arrays, e.g.',
        '{"roles":["Data Scientist","Software Engineer"],"specializations":["Machine Learning","Platform Engineering"]}.',
        'If no meaningful patterns exist, return {"roles":[],"specializations":[]}.',
        'Limit each array to at most 20 items.',
      ].join('\n');

      // 4. Call DeepSeek
      const schema = {
        type: 'object' as const,
        properties: {
          roles: {
            type: 'array' as const,
            items: { type: 'string' as const },
          },
          specializations: {
            type: 'array' as const,
            items: { type: 'string' as const },
          },
        },
        required: ['roles', 'specializations'],
      };

      const response = await callDeepSeek(prompt, schema, {
        temperature: 0.2,
      });

      // 5. Parse, compute keyword match frequencies, sort alphabetically, and return
      const parsed = JSON.parse(response.content) as {
        roles: string[];
        specializations: string[];
      };

      // Helper: count how many job titles contain a keyword (case-insensitive substring)
      const countMatches = (keyword: string): number => {
        const lower = keyword.toLowerCase();
        return jobs.filter((j) => j.title.toLowerCase().includes(lower)).length;
      };

      const roles: FrequencyItem[] = parsed.roles
        .map((name) => ({ name, count: countMatches(name) }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const specializations: FrequencyItem[] = parsed.specializations
        .map((name) => ({ name, count: countMatches(name) }))
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json({ roles, specializations });
    } catch (err) {
      if (err instanceof FetchError) {
        res
          .status(502)
          .json({ error: 'Greenhouse API error', detail: err.message });
      } else if (err instanceof LlmApiError) {
        res
          .status(502)
          .json({ error: 'LLM API error', detail: err.message });
      } else if (err instanceof LlmSchemaError) {
        res
          .status(502)
          .json({
            error: 'LLM response validation failed',
            detail: err.message,
          });
      } else {
        res
          .status(500)
          .json({ error: 'Internal server error', detail: String(err) });
      }
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/config/company
//
// Creates a new company config file.  The request body must include a
// `token` (the config filename stem) and optionally a `config` object with
// initial values.  If only `token` is provided a minimal valid config is
// scaffolded.
// ---------------------------------------------------------------------------

router.post('/config/company', (req: Request, res: Response) => {
  const { token, config: partialConfig } = req.body as {
    token?: string;
    config?: Record<string, unknown>;
  };

  // Validate token
  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    res.status(400).json({
      error: 'Validation failed',
      detail: 'Field "token" is required and must be a non-empty string.',
    });
    return;
  }

  const filePath = path.resolve(companiesDir(), `${token}.json`);

  try {
    // Reject if already exists
    if (fs.existsSync(filePath)) {
      res.status(409).json({
        error: 'Company already exists',
        detail: `A company with token "${token}" already exists. Use PUT to update it.`,
      });
      return;
    }

    // Ensure target directory exists
    fs.mkdirSync(companiesDir(), { recursive: true });

    // Build the initial config — merge provided fields with defaults
    const defaultConfig: Record<string, unknown> = {
      name: token, // default name = token
      departments: ['Engineering'],
      location: '',
      keyword: '',
      boardToken: '',
      sectionHeaders: {
        must_have: ["We'd love to hear from you if you have:"],
        nice_to_have: ["While it's not required, it's an added plus if you also have:"],
      },
    };

    const merged: Record<string, unknown> = {
      ...defaultConfig,
      ...(partialConfig ?? {}),
    };

    // Preserve the user-supplied token as default name if no name given
    if (!merged.name || (partialConfig && !partialConfig.name)) {
      merged.name = token;
    }

    // Write and validate
    const raw = JSON.stringify(merged, null, 2);
    fs.writeFileSync(filePath, raw, 'utf-8');

    // Validate by loading
    try {
      loadCompanyConfig(token);
    } catch (validateErr) {
      // Validation failed — clean up
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Best-effort cleanup
      }
      handleValidationError(validateErr, res);
      return;
    }

    const created = loadCompanyConfig(token);
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      handleValidationError(err, res);
    } else {
      res.status(500).json({ error: 'Internal server error', detail: String(err) });
    }
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/config/company/:token
//
// Deletes a company config file.  Returns 404 if the file does not exist.
// ---------------------------------------------------------------------------

router.delete('/config/company/:token', (req: Request, res: Response) => {
  const { token } = req.params;
  const filePath = path.resolve(companiesDir(), `${token}.json`);

  try {
    if (!fs.existsSync(filePath)) {
      res.status(404).json({
        error: 'Company not found',
        detail: `No company config found for token "${token}".`,
      });
      return;
    }

    fs.unlinkSync(filePath);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Internal server error', detail: String(err) });
  }
});

export default router;
