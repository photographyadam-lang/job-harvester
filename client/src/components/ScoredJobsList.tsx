/**
 * ScoredJobsList
 *
 * Renders matched jobs sorted descending by score with score badge,
 * reasoning sentence, and matched/unmatched must-have lists.
 */

import type { ScoredJobSummary } from '../types/events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoredJobsListProps {
  scoredJobs: ScoredJobSummary[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pick a badge color based on the score value (1–10).
 */
function scoreColor(score: number): string {
  if (score >= 9) return '#16a34a'; // green
  if (score >= 7) return '#22c55e'; // lighter green
  if (score >= 5) return '#eab308'; // yellow
  if (score >= 3) return '#f97316'; // orange
  return '#ef4444'; // red
}

/**
 * Format an ISO 8601 timestamp into a compact readable date.
 * Returns "—" for undefined / unparseable values.
 */
function formatDate(iso?: string): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScoredJobsList({ scoredJobs }: ScoredJobsListProps) {
  if (scoredJobs.length === 0) {
    return null;
  }

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
      <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem' }}>
        Scored Jobs ({scoredJobs.length})
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {scoredJobs.map((job) => (
          <div
            key={job.id}
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              padding: '0.75rem',
              background: '#ffffff',
            }}
          >
            {/* Header row: title + score badge */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '0.2rem',
                gap: '0.5rem',
              }}
            >
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontWeight: 600,
                  fontSize: '0.95rem',
                  color: '#1d4ed8',
                  textDecoration: 'none',
                  flex: 1,
                }}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLElement).style.textDecoration = 'underline';
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLElement).style.textDecoration = 'none';
                }}
              >
                {job.title}
              </a>

              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '36px',
                  height: '28px',
                  borderRadius: '6px',
                  background: scoreColor(job.score),
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  padding: '0 0.4rem',
                  flexShrink: 0,
                }}
                title={`Score: ${job.score}/10`}
              >
                {job.score}
              </span>
            </div>

            {/* Metadata row: department · location · gap ratio · dates */}
            <div
              style={{
                fontSize: '0.78rem',
                color: '#6b7280',
                marginBottom: '0.5rem',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.15rem 0.6rem',
              }}
            >
              <span>{job.department}</span>
              <span style={{ color: '#d1d5db' }}>·</span>
              <span>{job.location}</span>
              <span style={{ color: '#d1d5db' }}>·</span>
              <span>gap: {job.gapRatio.toFixed(2)}</span>
              {job.updatedAt && (
                <>
                  <span style={{ color: '#d1d5db' }}>·</span>
                  <span>Updated: {formatDate(job.updatedAt)}</span>
                </>
              )}
              {job.firstPublished && (
                <>
                  <span style={{ color: '#d1d5db' }}>·</span>
                  <span>Published: {formatDate(job.firstPublished)}</span>
                </>
              )}
            </div>

            {/* Reasoning */}
            <p
              style={{
                margin: '0 0 0.6rem 0',
                fontSize: '0.85rem',
                color: '#4b5563',
                lineHeight: 1.4,
              }}
            >
              {job.scoreReasoning}
            </p>

            {/* Skills row */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '1rem',
                fontSize: '0.8rem',
              }}
            >
              {/* Matched skills */}
              {job.matchedSkills.length > 0 && (
                <div style={{ flex: '1 1 200px' }}>
                  <span
                    style={{
                      fontWeight: 600,
                      color: '#166534',
                      display: 'block',
                      marginBottom: '0.2rem',
                    }}
                  >
                    ✓ Matched
                  </span>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#166534' }}>
                    {job.matchedSkills.map((skill) => (
                      <li key={skill}>{skill}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Unmatched skills */}
              {job.unmatchedSkills.length > 0 && (
                <div style={{ flex: '1 1 200px' }}>
                  <span
                    style={{
                      fontWeight: 600,
                      color: '#991b1b',
                      display: 'block',
                      marginBottom: '0.2rem',
                    }}
                  >
                    ✗ Unmatched
                  </span>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#991b1b' }}>
                    {job.unmatchedSkills.map((skill) => (
                      <li key={skill}>{skill}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Must-haves from the job posting */}
              {job.mustHaves.length > 0 && (
                <div style={{ flex: '1 1 200px' }}>
                  <span
                    style={{
                      fontWeight: 600,
                      color: '#4b5563',
                      display: 'block',
                      marginBottom: '0.2rem',
                    }}
                  >
                    Required
                  </span>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#4b5563' }}>
                    {job.mustHaves.map((req, i) => (
                      <li key={i}>{req}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
