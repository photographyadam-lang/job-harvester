/**
 * Stage 3a — Normalizer
 *
 * Pure function that converts raw job HTML to clean Markdown.
 *
 * Processing order:
 *   1. HTML entity decode
 *   2. Mojibake repair
 *   3. Truncate at `content-conclusion`
 *   4. Strip remaining HTML tags
 *   5. Convert `<h4>` → `###` and `<li>` → `*`
 *   6. Collapse blank lines
 *   7. Trim
 *
 * This module is pure: no I/O, no LLM calls, no network.
 */

import { decode } from 'he';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown when `normalizeJobHtml` produces an empty string after processing.
 */
export class NormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NormalizationError';
  }
}

// ---------------------------------------------------------------------------
// Mojibake repair map
// ---------------------------------------------------------------------------

/**
 * Common mojibake patterns originating from UTF-8 / Latin-1 (Windows-1252)
 * corruption. Keys are ordered longest-first so that multi-byte sequences
 * are matched before their trailing substrings.
 */
const MOJIBAKE_PATTERNS: [string, string][] = [
  // RIGHT SINGLE QUOTATION MARK (U+2019): UTF-8 bytes E2 80 99 decoded as Latin-1 → â + control chars
  ['\u00e2\u0080\u0099', "'"],
  // LEFT DOUBLE QUOTATION MARK (U+201C): UTF-8 bytes E2 80 9C
  ['\u00e2\u0080\u009c', '"'],
  // RIGHT DOUBLE QUOTATION MARK (U+201D): UTF-8 bytes E2 80 9D
  ['\u00e2\u0080\u009d', '"'],
  // EM DASH (U+2014): UTF-8 bytes E2 80 94
  ['\u00e2\u0080\u0094', '\u2014'],
  // EN DASH (U+2013): UTF-8 bytes E2 80 93
  ['\u00e2\u0080\u0093', '\u2013'],
  // Common Latin-1 mis-encodings
  ['\u00c3\u00a9', '\u00e9'],   // é
  ['\u00c3\u00bc', '\u00fc'],   // ü
  ['\u00c3\u00b1', '\u00f1'],   // ñ
  ['\u00c3\u00a0', '\u00e0'],   // à
  ['\u00c3\u00a1', '\u00e1'],   // á
  ['\u00c3\u00a4', '\u00e4'],   // ä
  ['\u00c3\u00a7', '\u00e7'],   // ç
  ['\u00c3\u00a8', '\u00e8'],   // è
  ['\u00c3\u00aa', '\u00ea'],   // ê
  ['\u00c3\u00ab', '\u00eb'],   // ë
  ['\u00c3\u00ac', '\u00ec'],   // ì
  ['\u00c3\u00ad', '\u00ed'],   // í
  ['\u00c3\u00ae', '\u00ee'],   // î
  ['\u00c3\u00af', '\u00ef'],   // ï
  ['\u00c3\u00b2', '\u00f2'],   // ò
  ['\u00c3\u00b3', '\u00f3'],   // ó
  ['\u00c3\u00b4', '\u00f4'],   // ô
  ['\u00c3\u00b6', '\u00f6'],   // ö
  ['\u00c3\u00b9', '\u00f9'],   // ù
  ['\u00c3\u00ba', '\u00fa'],   // ú
  ['\u00c3\u00bb', '\u00fb'],   // û
  // Catch-all: remaining â → apostrophe (common in Greenhouse content)
  ['\u00e2', "'"],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply the mojibake repair map to a string.
 * Longer patterns are matched first to avoid partial replacements.
 */
function repairMojibake(text: string): string {
  let result = text;
  for (const [pattern, replacement] of MOJIBAKE_PATTERNS) {
    result = result.split(pattern).join(replacement);
  }
  return result;
}

/**
 * Truncate the string at the first occurrence of a `<div` whose class
 * attribute contains "content-conclusion". Everything from that tag
 * onward is removed. Returns `true` if truncation occurred.
 */
function truncateAtConclusion(text: string): { text: string; truncated: boolean } {
  // Match <div ... class="...content-conclusion..." ...>
  const conclusionRegex = /<div[^>]*class\s*=\s*["'][^"']*content-conclusion[^"']*["'][^>]*>/i;
  const match = conclusionRegex.exec(text);
  if (match) {
    return { text: text.slice(0, match.index), truncated: true };
  }
  return { text, truncated: false };
}

/**
 * Strip all HTML tags from the string, replacing `<br>` with a newline.
 */
function stripTags(text: string): string {
  // Replace <br> with newline first
  let result = text.replace(/<br\s*\/?>/gi, '\n');
  // Remove all remaining tags
  result = result.replace(/<[^>]*>/g, '');
  return result;
}

/**
 * Convert structural HTML tags to Markdown equivalents.
 */
function convertStructuralTags(text: string): string {
  let result = text;

  // <h4>content</h4> → ### content
  result = result.replace(/<h4[^>]*>/gi, '### ');
  result = result.replace(/<\/h4>/gi, '');

  // <li>content</li> → * content  (one per line)
  result = result.replace(/<li[^>]*>/gi, '* ');
  result = result.replace(/<\/li>/gi, '');

  // Remove empty list wrappers (<ul>, <ol>)
  result = result.replace(/<\/?ul[^>]*>/gi, '\n');
  result = result.replace(/<\/?ol[^>]*>/gi, '\n');

  return result;
}

/**
 * Collapse runs of blank lines (2+ newlines) into a single blank line.
 */
function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize raw job HTML into clean Markdown.
 *
 * @param rawHtml - Raw HTML content from a Greenhouse job posting.
 * @returns An object containing the resulting Markdown string and a flag
 *          indicating whether the content was truncated at "content-conclusion".
 * @throws {NormalizationError} When the result is empty after processing.
 */
export function normalizeJobHtml(rawHtml: string): { markdown: string; truncated: boolean } {
  // Step 1 — HTML entity decode
  let text = decode(rawHtml);

  // Step 2 — Mojibake repair
  text = repairMojibake(text);

  // Step 3 — Truncate at content-conclusion
  const { text: beforeConclusion, truncated } = truncateAtConclusion(text);
  text = beforeConclusion;

  // Step 4 — Convert structural tags (h4 → ###, li → *)
  text = convertStructuralTags(text);

  // Step 5 — Strip remaining HTML tags
  text = stripTags(text);

  // Step 6 — Collapse blank lines
  text = collapseBlankLines(text);

  // Step 7 — Trim
  text = text.trim();

  if (text.length === 0) {
    throw new NormalizationError(
      'normalizeJobHtml produced empty output from the provided HTML',
    );
  }

  return { markdown: text, truncated };
}
