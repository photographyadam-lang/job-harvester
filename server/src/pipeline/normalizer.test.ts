/**
 * Stage 3a — Normalizer tests
 *
 * @jest-environment node
 */

import { normalizeJobHtml, NormalizationError } from './normalizer';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Read the Figma API response fixture and extract the first job's content.
 * Strips UTF-16 BOM before parsing.
 */
function getFigmaJobContent(): string {
  const fixturePath = path.resolve(__dirname, '../../__fixtures__/figma-api-response.json');
  // File is UTF-16LE with BOM
  let text = fs.readFileSync(fixturePath, 'utf16le');
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  const raw = JSON.parse(text) as { jobs: Array<{ content: string }> };
  return raw.jobs[0].content;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ASCII characters used to build entity strings without source corruption. */
const _AMP = String.fromCharCode(38);  // &
const _LT = String.fromCharCode(60);   // <
const _GT = String.fromCharCode(62);   // >
const _QUOT = String.fromCharCode(34); // "

/** Build an HTML entity reference like `&` without risking tool corruption. */
function ent(name: string): string {
  return _AMP + name + ';';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalizeJobHtml', () => {
  // -----------------------------------------------------------------------
  // 1. HTML entity decode
  // -----------------------------------------------------------------------

  test('decodes HTML entities', () => {
    // Build: <div>Hello & welcome "world"</div>
    const html =
      _LT + 'div' + _GT +
      'Hello ' + ent('amp') + ' welcome ' + ent('quot') + 'world' + ent('quot') +
      _LT + '/div' + _GT;

    const result = normalizeJobHtml(html);
    expect(result.markdown).toContain('Hello');
    expect(result.markdown).toContain(_AMP); // & decoded to &
    expect(result.markdown).toContain(_QUOT + 'world' + _QUOT);
    expect(result.markdown).not.toContain(ent('amp'));
    expect(result.markdown).not.toContain(ent('quot'));
  });

  // -----------------------------------------------------------------------
  // 2. Mojibake apostrophe
  // -----------------------------------------------------------------------

  test('repairs mojibake apostrophe', () => {
    const html = '<p>Figma\u00e2s platform helps teams</p>';
    const result = normalizeJobHtml(html);
    expect(result.markdown).toContain("Figma's");
    expect(result.markdown).not.toContain('Figma\u00e2s');
  });

  // -----------------------------------------------------------------------
  // 3. Mojibake contraction
  // -----------------------------------------------------------------------

  test('repairs mojibake contraction', () => {
    const html = '<p>You won\u00e2t believe this</p>';
    const result = normalizeJobHtml(html);
    expect(result.markdown).toContain("won't");
    expect(result.markdown).not.toContain('won\u00e2t');
  });

  // -----------------------------------------------------------------------
  // 4. Content-conclusion stripped with truncated: true
  // -----------------------------------------------------------------------

  test('strips content-conclusion and sets truncated: true', () => {
    const html =
      '<div class="content-intro"><p>Intro text</p></div>' +
      '<div class="content-conclusion"><p>EEO statement</p></div>';
    const result = normalizeJobHtml(html);
    expect(result.truncated).toBe(true);
    expect(result.markdown).toContain('Intro text');
    expect(result.markdown).not.toContain('EEO statement');
    expect(result.markdown).not.toContain('content-conclusion');
  });

  // -----------------------------------------------------------------------
  // 5. Content-intro retained
  // -----------------------------------------------------------------------

  test('retains content-intro div', () => {
    const html = '<div class="content-intro"><p>Important intro</p></div><p>Other stuff</p>';
    const result = normalizeJobHtml(html);
    expect(result.markdown).toContain('Important intro');
  });

  // -----------------------------------------------------------------------
  // 6. No content-conclusion sets truncated: false
  // -----------------------------------------------------------------------

  test('no content-conclusion sets truncated: false', () => {
    const html = '<div class="content-intro"><p>Only intro</p></div><p>More content</p>';
    const result = normalizeJobHtml(html);
    expect(result.truncated).toBe(false);
    expect(result.markdown).toContain('Only intro');
    expect(result.markdown).toContain('More content');
  });

  // -----------------------------------------------------------------------
  // 7. <h4> to markdown heading
  // -----------------------------------------------------------------------

  test('converts h4 to markdown heading', () => {
    const html = '<h4>Qualifications</h4><p>Details</p>';
    const result = normalizeJobHtml(html);
    expect(result.markdown).toMatch(/^### /m);
    expect(result.markdown).toContain('Qualifications');
    expect(result.markdown).not.toContain('<h4>');
  });

  // -----------------------------------------------------------------------
  // 8. <li> to markdown list item
  // -----------------------------------------------------------------------

  test('converts li to markdown list item', () => {
    const html = '<ul><li>First item</li><li>Second item</li></ul>';
    const result = normalizeJobHtml(html);
    expect(result.markdown).toMatch(/^\* /m);
    expect(result.markdown).toContain('First item');
    expect(result.markdown).toContain('Second item');
    expect(result.markdown).not.toContain('<li>');
  });

  // -----------------------------------------------------------------------
  // 9. Tags stripped
  // -----------------------------------------------------------------------

  test('strips all remaining HTML tags from output', () => {
    const html =
      '<div class="content-intro"><p>Hello <strong>World</strong></p><span>Extra</span></div>';
    const result = normalizeJobHtml(html);
    expect(result.markdown).not.toContain('<');
    expect(result.markdown).not.toContain('>');
    expect(result.markdown).toContain('Hello');
    expect(result.markdown).toContain('World');
    expect(result.markdown).toContain('Extra');
  });

  // -----------------------------------------------------------------------
  // 10. Empty result throws NormalizationError
  // -----------------------------------------------------------------------

  test('throws NormalizationError when result is empty after processing', () => {
    const html = '<div class="content-conclusion"><p>Only conclusion</p></div>';
    expect(() => normalizeJobHtml(html)).toThrow(NormalizationError);
  });

  test('throws NormalizationError for completely empty input', () => {
    expect(() => normalizeJobHtml('')).toThrow(NormalizationError);
  });

  test('throws NormalizationError for whitespace-only input', () => {
    expect(() => normalizeJobHtml('   \n  \t  ')).toThrow(NormalizationError);
  });

  // -----------------------------------------------------------------------
  // 11. Real Figma fixture round-trip
  // -----------------------------------------------------------------------

  test('real Figma fixture round-trip produces clean markdown', () => {
    const content = getFigmaJobContent();
    const result = normalizeJobHtml(content);

    // No HTML tags in output
    expect(result.markdown).not.toMatch(/<[^>]+>/);

    // Intro text present
    expect(result.markdown).toContain('Figma is growing');

    // EEO boilerplate absent (content-conclusion stripped)
    expect(result.markdown).not.toMatch(/EEO/i);
    expect(result.markdown).not.toMatch(/equal opportunity/i);
    expect(result.markdown).not.toMatch(/disabilities/i);

    // Result is non-empty
    expect(result.markdown.length).toBeGreaterThan(0);
  });
});
