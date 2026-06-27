/**
 * StagePanel
 *
 * Renders a single pipeline stage panel showing:
 * - Stage label and status (running / complete / pending)
 * - Passed jobs (green) inline as JobRow items
 * - Rejected jobs (red) with reason, inline as JobRow items
 *
 * The panel updates reactively as job-passed and job-rejected SSE events
 * arrive — it does not wait for stage-complete before rendering jobs.
 */

import { JobRow } from './JobRow';
import type { StageNumber } from '../types/events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PassedJob {
  id: number;
  title: string;
  url: string;
}

interface RejectedJob {
  id: number;
  title: string;
  url: string;
  reason: string;
}

export interface StagePanelProps {
  /** 1-indexed stage number */
  stage: StageNumber;
  /** Human-readable stage label (e.g. "Fetch jobs") */
  label: string;
  /** Jobs that passed this stage */
  passedJobs: PassedJob[];
  /** Jobs that were rejected at this stage */
  rejectedJobs: RejectedJob[];
  /** Whether this stage is currently executing */
  isRunning: boolean;
  /** Whether this stage has completed */
  isComplete: boolean;
  /** Whether the stage has not started yet */
  isPending: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGE_COLORS: Record<StageNumber, string> = {
  1: '#6366f1', // indigo
  2: '#0ea5e9', // sky
  3: '#8b5cf6', // violet
  4: '#f59e0b', // amber
  5: '#10b981', // emerald
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StagePanel({
  stage,
  label,
  passedJobs,
  rejectedJobs,
  isRunning,
  isComplete,
  isPending,
}: StagePanelProps) {
  const accentColor = STAGE_COLORS[stage];
  const totalJobs = passedJobs.length + rejectedJobs.length;

  // Derive status badge
  let statusBadge: string;
  let badgeColor: string;
  if (isRunning) {
    statusBadge = '● Running';
    badgeColor = '#2563eb';
  } else if (isComplete) {
    statusBadge = '✓ Complete';
    badgeColor = '#16a34a';
  } else {
    statusBadge = '○ Pending';
    badgeColor = '#9ca3af';
  }

  return (
    <div
      style={{
        border: `1px solid ${accentColor}40`,
        borderRadius: '8px',
        padding: '1rem',
        marginBottom: '0.75rem',
        background: isRunning ? `${accentColor}08` : '#ffffff',
        opacity: isPending ? 0.55 : 1,
        transition: 'opacity 0.2s, background 0.2s',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: accentColor,
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.85rem',
            }}
          >
            {stage}
          </span>
          <strong style={{ fontSize: '1rem' }}>{label}</strong>
        </div>

        <span
          style={{
            fontSize: '0.8rem',
            fontWeight: 600,
            color: badgeColor,
          }}
        >
          {statusBadge}
        </span>
      </div>

      {/* Summary counts */}
      {totalJobs > 0 && (
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            marginBottom: '0.75rem',
            fontSize: '0.85rem',
          }}
        >
          <span style={{ color: '#166534' }}>
            {passedJobs.length} passed
          </span>
          {rejectedJobs.length > 0 && (
            <span style={{ color: '#991b1b' }}>
              {rejectedJobs.length} rejected
            </span>
          )}
        </div>
      )}

      {/* Passed jobs */}
      {passedJobs.length > 0 && (
        <div style={{ marginBottom: rejectedJobs.length > 0 ? '0.5rem' : 0 }}>
          <div
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: '#166534',
              marginBottom: '0.25rem',
            }}
          >
            Passed
          </div>
          <ul style={{ margin: 0, padding: 0 }}>
            {passedJobs.map((job) => (
              <JobRow key={`p-${job.id}`} variant="passed" job={job} />
            ))}
          </ul>
        </div>
      )}

      {/* Rejected jobs */}
      {rejectedJobs.length > 0 && (
        <div>
          <div
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: '#991b1b',
              marginBottom: '0.25rem',
            }}
          >
            Rejected
          </div>
          <ul style={{ margin: 0, padding: 0 }}>
            {rejectedJobs.map((job) => (
              <JobRow key={`r-${job.id}`} variant="rejected" job={job} />
            ))}
          </ul>
        </div>
      )}

      {/* Empty state */}
      {totalJobs === 0 && !isPending && (
        <p style={{ fontSize: '0.85rem', color: '#9ca3af', margin: 0 }}>
          No jobs processed yet…
        </p>
      )}
    </div>
  );
}
