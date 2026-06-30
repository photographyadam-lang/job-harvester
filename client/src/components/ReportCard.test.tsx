import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ReportCard } from './ReportCard';
import type { ReportCard as ReportCardData } from '../types/events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReportCard(
  overrides: Partial<ReportCardData> = {},
): ReportCardData {
  return {
    stages: [],
    totalPassed: 0,
    totalRejected: 0,
    totalRuntimeMs: 0,
    estimatedCostUsd: 0,
    heuristicHits: 0,
    llmFallbacks: 0,
    ...overrides,
  };
}

/** Find a summary-row div by its label text and return the full textContent. */
function summaryText(label: string): string {
  const strong = screen.getByText(label);
  const parent = strong.closest('div');
  return parent?.textContent ?? '';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReportCard', () => {
  // ---------------------------------------------------------------------------
  // Total counts
  // ---------------------------------------------------------------------------

  it('renders total passed and rejected counts', () => {
    render(
      <ReportCard
        reportCard={makeReportCard({ totalPassed: 12, totalRejected: 5 })}
      />,
    );

    expect(screen.getByText('Report Card')).toBeDefined();
    // The text renders as "<strong>Total jobs:</strong> 17" within a div
    expect(summaryText('Total jobs:')).toContain('17');
    expect(summaryText('Passed:')).toContain('12');
    expect(summaryText('Rejected:')).toContain('5');
  });

  it('renders total jobs as sum of passed + rejected', () => {
    render(
      <ReportCard
        reportCard={makeReportCard({ totalPassed: 8, totalRejected: 2 })}
      />,
    );

    expect(summaryText('Total jobs:')).toContain('10');
  });

  // ---------------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------------

  it('renders runtime in milliseconds when under 1000ms', () => {
    render(
      <ReportCard reportCard={makeReportCard({ totalRuntimeMs: 500 })} />,
    );

    expect(summaryText('Runtime:')).toContain('500ms');
  });

  it('renders runtime in seconds when 1000ms or more', () => {
    render(
      <ReportCard reportCard={makeReportCard({ totalRuntimeMs: 2500 })} />,
    );

    expect(summaryText('Runtime:')).toContain('2.5s');
  });

  // ---------------------------------------------------------------------------
  // Estimated cost
  // ---------------------------------------------------------------------------

  it('renders estimated cost', () => {
    render(
      <ReportCard reportCard={makeReportCard({ estimatedCostUsd: 0.42 })} />,
    );

    expect(summaryText('Estimated cost:')).toContain('$0.42');
  });

  it('renders estimated cost with extra precision when under 1 cent', () => {
    render(
      <ReportCard
        reportCard={makeReportCard({ estimatedCostUsd: 0.0042 })}
      />,
    );

    expect(summaryText('Estimated cost:')).toContain('$0.0042');
  });

  // ---------------------------------------------------------------------------
  // Per-stage breakdown
  // ---------------------------------------------------------------------------

  it('renders per-stage breakdown table with stage labels', () => {
    render(
      <ReportCard
        reportCard={makeReportCard({
          stages: [
            { stage: 1, passedCount: 50, rejectedCount: 10 },
            { stage: 2, passedCount: 30, rejectedCount: 20 },
            { stage: 3, passedCount: 20, rejectedCount: 10 },
            { stage: 4, passedCount: 15, rejectedCount: 5 },
            { stage: 5, passedCount: 10, rejectedCount: 5 },
          ],
        })}
      />,
    );

    // Stage labels in table rows
    expect(screen.getByText('Fetch')).toBeDefined();
    expect(screen.getByText('Metadata filter')).toBeDefined();
    expect(screen.getByText('Extract requirements')).toBeDefined();
    expect(screen.getByText('Gap filter')).toBeDefined();
    expect(screen.getByText('Score jobs')).toBeDefined();
  });

  it('renders passed/rejected counts per stage in table cells', () => {
    render(
      <ReportCard
        reportCard={makeReportCard({
          stages: [{ stage: 1, passedCount: 42, rejectedCount: 7 }],
        })}
      />,
    );

    // Table cells contain text "42" (passed) and "7" (rejected)
    const cells = screen.getAllByRole('cell');
    const cellTexts = cells.map((c) => c.textContent);
    expect(cellTexts).toContain('42');
    expect(cellTexts).toContain('7');
  });

  // ---------------------------------------------------------------------------
  // Heuristic / LLM ratio
  // ---------------------------------------------------------------------------

  it('renders heuristic hits and LLM fallbacks when present', () => {
    render(
      <ReportCard
        reportCard={makeReportCard({ heuristicHits: 30, llmFallbacks: 10 })}
      />,
    );

    expect(screen.getByText(/Heuristic extractions:/)).toBeDefined();
    expect(screen.getByText(/LLM fallbacks:/)).toBeDefined();
    expect(screen.getByText(/Heuristic rate:/)).toBeDefined();
    // 30 / (30 + 10) = 75%
    expect(screen.getByText('75%')).toBeDefined();
  });

  it('does not show heuristic section when both counts are zero', () => {
    render(
      <ReportCard
        reportCard={makeReportCard({ heuristicHits: 0, llmFallbacks: 0 })}
      />,
    );

    // The entire heuristic / LLM row is hidden when both are zero
    expect(screen.queryByText(/Heuristic extractions:/)).toBeNull();
    expect(screen.queryByText(/LLM fallbacks:/)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Zero values
  // ---------------------------------------------------------------------------

  it('handles zero values gracefully', () => {
    render(
      <ReportCard
        reportCard={makeReportCard({
          totalPassed: 0,
          totalRejected: 0,
          totalRuntimeMs: 0,
          estimatedCostUsd: 0,
          heuristicHits: 0,
          llmFallbacks: 0,
          stages: [],
        })}
      />,
    );

    // Should render the heading and summary without crashing
    expect(screen.getByText('Report Card')).toBeDefined();
    expect(summaryText('Total jobs:')).toContain('0');
    expect(summaryText('Runtime:')).toContain('0ms');
    expect(summaryText('Estimated cost:')).toContain('$0.00');
  });

  it('handles empty stages array gracefully', () => {
    render(
      <ReportCard
        reportCard={makeReportCard({
          totalPassed: 5,
          totalRejected: 3,
          stages: [],
        })}
      />,
    );

    // Should render without a table body (no stage rows), but still show summary
    expect(screen.getByText('Report Card')).toBeDefined();
    expect(summaryText('Total jobs:')).toContain('8');
  });
});
