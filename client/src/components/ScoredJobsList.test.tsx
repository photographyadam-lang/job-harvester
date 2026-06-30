import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ScoredJobsList } from './ScoredJobsList';
import type { ScoredJobSummary } from '../types/events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScoredJob(
  overrides: Partial<ScoredJobSummary> = {},
): ScoredJobSummary {
  return {
    id: 1,
    title: 'Frontend Engineer',
    url: 'https://example.com/job/1',
    score: 8,
    scoreReasoning: 'Good match for required skills.',
    matchedSkills: ['React', 'TypeScript'],
    unmatchedSkills: ['Python'],
    mustHaves: ['React', 'TypeScript'],
    niceToHaves: ['GraphQL'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScoredJobsList', () => {
  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  it('returns null (renders nothing) when scoredJobs is empty', () => {
    const { container } = render(<ScoredJobsList scoredJobs={[]} />);

    expect(container.innerHTML).toBe('');
  });

  // ---------------------------------------------------------------------------
  // List rendering
  // ---------------------------------------------------------------------------

  it('renders the section heading with job count', () => {
    render(
      <ScoredJobsList
        scoredJobs={[makeScoredJob(), makeScoredJob({ id: 2, title: 'Backend Dev' })]}
      />,
    );

    expect(screen.getByText('Scored Jobs (2)')).toBeDefined();
  });

  it('renders job title as a link', () => {
    render(<ScoredJobsList scoredJobs={[makeScoredJob()]} />);

    const link = screen.getByRole('link', { name: 'Frontend Engineer' });
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('https://example.com/job/1');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('renders score badge for each job', () => {
    render(<ScoredJobsList scoredJobs={[makeScoredJob({ score: 8 })]} />);

    // Score appears in the badge span
    const badges = screen.getAllByText('8');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('renders score reasoning', () => {
    render(
      <ScoredJobsList
        scoredJobs={[makeScoredJob({ scoreReasoning: 'Excellent candidate fit.' })]}
      />,
    );

    expect(screen.getByText('Excellent candidate fit.')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Skills rendering
  // ---------------------------------------------------------------------------

  it('renders matched skills section heading', () => {
    render(
      <ScoredJobsList
        scoredJobs={[
          makeScoredJob({
            matchedSkills: ['React', 'TypeScript', 'Node.js'],
            unmatchedSkills: [],
            mustHaves: [],
          }),
        ]}
      />,
    );

    expect(screen.getByText('✓ Matched')).toBeDefined();
  });

  it('renders each matched skill', () => {
    render(
      <ScoredJobsList
        scoredJobs={[
          makeScoredJob({
            matchedSkills: ['GraphQL', 'Docker'],
            unmatchedSkills: [],
            mustHaves: [],
          }),
        ]}
      />,
    );

    expect(screen.getByText('GraphQL')).toBeDefined();
    expect(screen.getByText('Docker')).toBeDefined();
  });

  it('renders unmatched skills section heading', () => {
    render(
      <ScoredJobsList
        scoredJobs={[
          makeScoredJob({
            matchedSkills: [],
            unmatchedSkills: ['Python', 'Django'],
            mustHaves: [],
          }),
        ]}
      />,
    );

    expect(screen.getByText('✗ Unmatched')).toBeDefined();
    expect(screen.getByText('Python')).toBeDefined();
    expect(screen.getByText('Django')).toBeDefined();
  });

  it('renders must-have requirements', () => {
    render(
      <ScoredJobsList
        scoredJobs={[
          makeScoredJob({
            matchedSkills: [],
            unmatchedSkills: [],
            mustHaves: ['5+ years experience', 'CS degree'],
          }),
        ]}
      />,
    );

    expect(screen.getByText('Required')).toBeDefined();
    expect(screen.getByText('5+ years experience')).toBeDefined();
    expect(screen.getByText('CS degree')).toBeDefined();
  });

  it('does not render matched/unmatched headings when skill arrays are empty', () => {
    render(
      <ScoredJobsList
        scoredJobs={[
          makeScoredJob({
            matchedSkills: [],
            unmatchedSkills: [],
            mustHaves: [],
          }),
        ]}
      />,
    );

    expect(screen.queryByText('✓ Matched')).toBeNull();
    expect(screen.queryByText('✗ Unmatched')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Multiple jobs
  // ---------------------------------------------------------------------------

  it('renders multiple scored jobs', () => {
    render(
      <ScoredJobsList
        scoredJobs={[
          makeScoredJob({ id: 1, title: 'Job A', score: 9, matchedSkills: [], unmatchedSkills: [], mustHaves: [] }),
          makeScoredJob({ id: 2, title: 'Job B', score: 6, matchedSkills: [], unmatchedSkills: [], mustHaves: [] }),
          makeScoredJob({ id: 3, title: 'Job C', score: 3, matchedSkills: [], unmatchedSkills: [], mustHaves: [] }),
        ]}
      />,
    );

    expect(screen.getByText('Scored Jobs (3)')).toBeDefined();
    expect(screen.getByText('Job A')).toBeDefined();
    expect(screen.getByText('Job B')).toBeDefined();
    expect(screen.getByText('Job C')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Score color mapping
  // ---------------------------------------------------------------------------

  it('renders high score (9+) with green badge background', () => {
    render(<ScoredJobsList scoredJobs={[makeScoredJob({ score: 10, matchedSkills: [], unmatchedSkills: [], mustHaves: [] })]} />);

    const badge = screen.getByText('10') as HTMLElement;
    expect(badge.style.background).toBe('rgb(22, 163, 74)'); // green
  });

  it('renders medium score (5-6) with yellow badge background', () => {
    render(<ScoredJobsList scoredJobs={[makeScoredJob({ score: 5, matchedSkills: [], unmatchedSkills: [], mustHaves: [] })]} />);

    const badge = screen.getByText('5') as HTMLElement;
    expect(badge.style.background).toBe('rgb(234, 179, 8)'); // yellow
  });

  it('renders low score (below 3) with red badge background', () => {
    render(<ScoredJobsList scoredJobs={[makeScoredJob({ score: 2, matchedSkills: [], unmatchedSkills: [], mustHaves: [] })]} />);

    const badge = screen.getByText('2') as HTMLElement;
    expect(badge.style.background).toBe('rgb(239, 68, 68)'); // red
  });
});
