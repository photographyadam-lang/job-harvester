/**
 * ReportCard
 *
 * Rendered on `run-complete` showing per-stage pass/fail counts,
 * heuristic/LLM ratio, estimated cost, and total runtime.
 */

import type { ReportCard as ReportCardData, StageNumber } from '../types/events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportCardProps {
  reportCard: ReportCardData;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<StageNumber, string> = {
  1: 'Fetch',
  2: 'Metadata filter',
  3: 'Extract requirements',
  4: 'Gap filter',
  5: 'Score jobs',
};

const STAGE_COLORS: Record<StageNumber, string> = {
  1: '#6366f1',
  2: '#0ea5e9',
  3: '#8b5cf6',
  4: '#f59e0b',
  5: '#10b981',
};

function formatUsd(cents: number): string {
  if (cents < 0.01) {
    return `$${cents.toFixed(4)}`;
  }
  return `$${cents.toFixed(2)}`;
}

function formatRuntime(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReportCard({ reportCard }: ReportCardProps) {
  const { stages, totalPassed, totalRejected, totalRuntimeMs, estimatedCostUsd, heuristicHits, llmFallbacks } =
    reportCard;

  const totalJobs = totalPassed + totalRejected;

  return (
    <section
      style={{
        border: '1px solid #d1d5db',
        borderRadius: '8px',
        padding: '1rem',
        marginBottom: '1.5rem',
        background: '#f9fafb',
      }}
    >
      <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem' }}>Report Card</h3>

      {/* Summary row */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1.5rem',
          marginBottom: '1rem',
          fontSize: '0.9rem',
        }}
      >
        <div>
          <strong>Total jobs:</strong> {totalJobs}
        </div>
        <div>
          <span style={{ color: '#166534' }}>
            <strong>Passed:</strong> {totalPassed}
          </span>
        </div>
        <div>
          <span style={{ color: '#991b1b' }}>
            <strong>Rejected:</strong> {totalRejected}
          </span>
        </div>
        <div>
          <strong>Runtime:</strong> {formatRuntime(totalRuntimeMs)}
        </div>
        <div>
          <strong>Estimated cost:</strong>{' '}
          <span style={{ fontWeight: 700, color: '#7c3aed' }}>
            {formatUsd(estimatedCostUsd)}
          </span>
        </div>
      </div>

      {/* Heuristic / LLM ratio */}
      {(heuristicHits > 0 || llmFallbacks > 0) && (
        <div
          style={{
            display: 'flex',
            gap: '1.5rem',
            marginBottom: '1rem',
            fontSize: '0.9rem',
          }}
        >
          <div>
            <strong>Heuristic extractions:</strong>{' '}
            <span style={{ color: '#166534' }}>{heuristicHits}</span>
          </div>
          <div>
            <strong>LLM fallbacks:</strong>{' '}
            <span style={{ color: '#7c3aed' }}>{llmFallbacks}</span>
          </div>
          <div>
            <strong>Heuristic rate:</strong>{' '}
            {heuristicHits + llmFallbacks > 0
              ? `${((heuristicHits / (heuristicHits + llmFallbacks)) * 100).toFixed(0)}%`
              : 'N/A'}
          </div>
        </div>
      )}

      {/* Per-stage breakdown */}
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.85rem',
        }}
      >
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem' }}>Stage</th>
            <th style={{ textAlign: 'center', padding: '0.35rem 0.5rem' }}>Passed</th>
            <th style={{ textAlign: 'center', padding: '0.35rem 0.5rem' }}>Rejected</th>
            <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((sr) => {
            const stageNum = sr.stage as StageNumber;
            const color = STAGE_COLORS[stageNum];
            const stageTotal = sr.passedCount + sr.rejectedCount;
            return (
              <tr
                key={sr.stage}
                style={{ borderBottom: '1px solid #f3f4f6' }}
              >
                <td style={{ padding: '0.35rem 0.5rem' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      background: color,
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '0.7rem',
                      marginRight: '0.4rem',
                    }}
                  >
                    {sr.stage}
                  </span>
                  {STAGE_LABELS[stageNum] ?? `Stage ${sr.stage}`}
                </td>
                <td style={{ textAlign: 'center', padding: '0.35rem 0.5rem', color: '#166534' }}>
                  {sr.passedCount}
                </td>
                <td style={{ textAlign: 'center', padding: '0.35rem 0.5rem', color: '#991b1b' }}>
                  {sr.rejectedCount}
                </td>
                <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>
                  {stageTotal}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
