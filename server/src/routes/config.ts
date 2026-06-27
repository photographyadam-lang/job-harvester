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
import { loadCompanyConfig } from '../config/companyConfig';
import { loadSkillsProfile } from '../config/skillsProfile';
import { ConfigValidationError } from '../config/types';
import { callDeepSeek, LlmApiError, LlmSchemaError } from '../llm/deepseekClient';
import { fetchJobs, FetchError } from '../pipeline/stage1-fetch';

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
// Fetches all job titles for the company from Greenhouse, sends them to
// DeepSeek to identify common role keywords, and returns the suggestions.
// The user initiates this from the Role Keyword field in the ConfigEditor UI.
// ---------------------------------------------------------------------------

router.post(
  '/config/company/:token/suggest-keywords',
  async (req: Request, res: Response) => {
    const { token } = req.params;

    try {
      // 1. Fetch all job titles for the company
      const { jobs } = await fetchJobs(token as string);

      // 2. Extract deduplicated, sorted job titles
      const titles = [...new Set(jobs.map((j) => j.title))].sort();

      // 3. Build the prompt
      const prompt = [
        'Given the following list of job titles from a company\'s careers page, identify common role keywords that could be used to filter jobs.',
        'A role keyword is a single word or short phrase that appears across multiple job titles and describes the role type (e.g. "Engineer", "Designer", "Manager", "Product").',
        '',
        'Guidelines:',
        '- Extract keywords that represent role types, not seniority levels ("Senior", "Lead", "Principal" are NOT keywords)',
        '- Do not include company names or location-based terms',
        '- Each keyword should be a short, descriptive term (1-3 words)',
        '- Only include keywords that are likely useful for filtering jobs by role',
        '',
        'Job titles:',
        ...titles.map((t) => `- ${t}`),
        '',
        'Return ONLY a JSON object with a "keywords" array of strings, e.g. {"keywords":["Engineer","Designer","Manager"]}.',
        'If no meaningful role patterns exist, return {"keywords":[]}.',
        'Limit to at most 12 keywords.',
      ].join('\n');

      // 4. Call DeepSeek
      const schema = {
        type: 'object' as const,
        properties: {
          keywords: {
            type: 'array' as const,
            items: { type: 'string' as const },
          },
        },
        required: ['keywords'],
      };

      const response = await callDeepSeek(prompt, schema, {
        temperature: 0.2,
      });

      // 5. Parse and return
      const parsed = JSON.parse(response.content) as { keywords: string[] };
      res.json({ keywords: parsed.keywords });
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

export default router;
