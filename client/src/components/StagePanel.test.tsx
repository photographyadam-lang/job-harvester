import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StagePanel } from './StagePanel';
import type { StagePanelProps } from './StagePanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(
  overrides: Partial<StagePanelProps> = {},
): StagePanelProps {
  return {
    stage: 2,
    label: 'Metadata filter',
    passedJobs: [],
    rejectedJobs: [],
    isRunning: false,
    isComplete: false,
    isPending: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StagePanel', () => {
  // ---------------------------------------------------------------------------
  // Stage label + number
  // ---------------------------------------------------------------------------

  it('renders stage label and number', () => {
    render(<StagePanel {...defaultProps({ stage: 3, label: 'Extract requirements' })} />);

    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('Extract requirements')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Status indicators
  // ---------------------------------------------------------------------------

  it('shows "Running" indicator when isRunning=true', () => {
    render(<StagePanel {...defaultProps({ isRunning: true })} />);

    expect(screen.getByText('● Running')).toBeDefined();
  });

  it('shows "Complete" checkmark when isComplete=true', () => {
    render(<StagePanel {...defaultProps({ isComplete: true })} />);

    expect(screen.getByText('✓ Complete')).toBeDefined();
  });

  it('shows "Pending" indicator when isPending=true', () => {
    render(<StagePanel {...defaultProps({ isPending: true })} />);

    expect(screen.getByText('○ Pending')).toBeDefined();
  });

  it('defaults to "Pending" when none of running/complete/pending is set', () => {
    render(
      <StagePanel
        {...defaultProps({ isRunning: false, isComplete: false, isPending: false })}
      />,
    );

    // When nothing is true, falls through to the else branch (Pending)
    expect(screen.getByText('○ Pending')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Passed / rejected counts
  // ---------------------------------------------------------------------------

  it('shows passed count and rejected count when jobs are present', () => {
    render(
      <StagePanel
        {...defaultProps({
          passedJobs: [
            { id: 1, title: 'Job A', url: 'https://a.com' },
            { id: 2, title: 'Job B', url: 'https://b.com' },
          ],
          rejectedJobs: [
            { id: 3, title: 'Job C', url: 'https://c.com', reason: 'low match' },
          ],
        })}
      />,
    );

    expect(screen.getByText('2 passed')).toBeDefined();
    expect(screen.getByText('1 rejected')).toBeDefined();
  });

  it('does not show count row when there are no jobs', () => {
    render(<StagePanel {...defaultProps({ passedJobs: [], rejectedJobs: [] })} />);

    // Summary counts only render when totalJobs > 0
    expect(screen.queryByText('0 passed')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Passed jobs list
  // ---------------------------------------------------------------------------

  it('renders passed jobs with "Passed" heading', () => {
    render(
      <StagePanel
        {...defaultProps({
          passedJobs: [
            { id: 1, title: 'Frontend Engineer', url: 'https://a.com' },
          ],
        })}
      />,
    );

    expect(screen.getByText('Passed')).toBeDefined();
    expect(screen.getByText('Frontend Engineer')).toBeDefined();
  });

  it('renders multiple passed jobs', () => {
    render(
      <StagePanel
        {...defaultProps({
          stage: 2,
          passedJobs: [
            { id: 1, title: 'Job One', url: 'https://a.com' },
            { id: 2, title: 'Job Two', url: 'https://b.com' },
          ],
        })}
      />,
    );

    // Both jobs should be rendered using JobRow
    expect(screen.getByText('Job One')).toBeDefined();
    expect(screen.getByText('Job Two')).toBeDefined();
  });

  it('renders Stage 1 passed jobs as a table with department, location, dates', () => {
    render(
      <StagePanel
        {...defaultProps({
          stage: 1,
          label: 'Fetch jobs',
          passedJobs: [
            {
              id: 1,
              title: 'Engineer',
              url: 'https://a.com',
              department: 'Engineering',
              location: 'Remote',
              updatedAt: '2025-06-01T12:00:00Z',
              firstPublished: '2025-05-15T12:00:00Z',
            },
          ],
        })}
      />,
    );

    // Table headers
    expect(screen.getByText('Job')).toBeDefined();
    expect(screen.getByText('Department')).toBeDefined();
    expect(screen.getByText('Location')).toBeDefined();
    expect(screen.getByText('Updated')).toBeDefined();
    expect(screen.getByText('Published')).toBeDefined();

    // Cell values
    expect(screen.getByText('Engineer')).toBeDefined();
    expect(screen.getByText('Engineering')).toBeDefined();
    expect(screen.getByText('Remote')).toBeDefined();
    expect(screen.getByText('2025-06-01')).toBeDefined();
    expect(screen.getByText('2025-05-15')).toBeDefined();
  });

  it('renders Stage 1 table with em-dash for missing optional fields', () => {
    render(
      <StagePanel
        {...defaultProps({
          stage: 1,
          label: 'Fetch jobs',
          passedJobs: [
            {
              id: 1,
              title: 'Minimal Job',
              url: 'https://a.com',
            },
          ],
        })}
      />,
    );

    // Missing fields should show em-dash
    const dashes = screen.getAllByText('\u2014');
    // department, location, updatedAt, firstPublished -> 4 dashes
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });

  // ---------------------------------------------------------------------------
  // Rejected jobs list
  // ---------------------------------------------------------------------------

  it('renders rejected jobs with "Rejected" heading and reasons', () => {
    render(
      <StagePanel
        {...defaultProps({
          rejectedJobs: [
            { id: 10, title: 'Bad Fit', url: 'https://c.com', reason: 'Missing skills' },
          ],
        })}
      />,
    );

    expect(screen.getByText('Rejected')).toBeDefined();
    expect(screen.getByText('Bad Fit')).toBeDefined();
    expect(screen.getByText('— Missing skills')).toBeDefined();
  });

  it('renders multiple rejected jobs', () => {
    render(
      <StagePanel
        {...defaultProps({
          rejectedJobs: [
            { id: 10, title: 'Rej A', url: 'https://c.com', reason: 'Reason A' },
            { id: 11, title: 'Rej B', url: 'https://d.com', reason: 'Reason B' },
          ],
        })}
      />,
    );

    expect(screen.getByText('Rej A')).toBeDefined();
    expect(screen.getByText('Rej B')).toBeDefined();
    expect(screen.getByText('— Reason A')).toBeDefined();
    expect(screen.getByText('— Reason B')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  it('shows empty state message when no jobs and not pending', () => {
    render(
      <StagePanel
        {...defaultProps({
          passedJobs: [],
          rejectedJobs: [],
          isPending: false,
        })}
      />,
    );

    expect(screen.getByText('No jobs processed yet…')).toBeDefined();
  });

  it('does not show empty state message when pending (opacity handles it)', () => {
    render(
      <StagePanel
        {...defaultProps({
          passedJobs: [],
          rejectedJobs: [],
          isPending: true,
        })}
      />,
    );

    // The empty state message is suppressed when isPending is true
    expect(screen.queryByText('No jobs processed yet…')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Visual styling
  // ---------------------------------------------------------------------------

  it('applies reduced opacity when isPending=true', () => {
    const { container } = render(
      <StagePanel {...defaultProps({ isPending: true })} />,
    );

    const panel = container.firstElementChild as HTMLElement;
    expect(panel.style.opacity).toBe('0.55');
  });

  it('applies full opacity when isPending=false', () => {
    const { container } = render(
      <StagePanel {...defaultProps({ isPending: false })} />,
    );

    const panel = container.firstElementChild as HTMLElement;
    expect(panel.style.opacity).toBe('1');
  });
});
