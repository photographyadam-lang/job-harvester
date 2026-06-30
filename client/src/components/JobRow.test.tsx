import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { JobRow } from './JobRow';

describe('JobRow', () => {
  // ---------------------------------------------------------------------------
  // Passed variant
  // ---------------------------------------------------------------------------

  it('renders job title as a link with the correct URL for passed variant', () => {
    render(
      <JobRow
        variant="passed"
        job={{ id: 1, title: 'Frontend Engineer', url: 'https://example.com/job/1' }}
      />,
    );

    const link = screen.getByRole('link', { name: 'Frontend Engineer' });
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('https://example.com/job/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders the passed variant link with green styling', () => {
    render(
      <JobRow
        variant="passed"
        job={{ id: 2, title: 'Backend Engineer', url: 'https://example.com/job/2' }}
      />,
    );

    const link = screen.getByRole('link', { name: 'Backend Engineer' });
    expect(link.style.color).toBe('rgb(22, 101, 52)'); // #166534
  });

  it('does not render a reason for passed variant', () => {
    render(
      <JobRow
        variant="passed"
        job={{ id: 3, title: 'DevOps Engineer', url: 'https://example.com/job/3' }}
      />,
    );

    // No reason span should be in the document
    const listItem = screen.getByRole('listitem');
    expect(listItem.textContent).toBe('DevOps Engineer');
  });

  // ---------------------------------------------------------------------------
  // Rejected variant
  // ---------------------------------------------------------------------------

  it('renders job title as a link with the correct URL for rejected variant', () => {
    render(
      <JobRow
        variant="rejected"
        job={{
          id: 4,
          title: 'Rejected Role',
          url: 'https://example.com/job/4',
          reason: 'Missing required skills',
        }}
      />,
    );

    const link = screen.getByRole('link', { name: 'Rejected Role' });
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('https://example.com/job/4');
  });

  it('renders the rejected variant link with red styling', () => {
    render(
      <JobRow
        variant="rejected"
        job={{
          id: 5,
          title: 'Another Rejected',
          url: 'https://example.com/job/5',
          reason: 'Not enough experience',
        }}
      />,
    );

    const link = screen.getByRole('link', { name: 'Another Rejected' });
    expect(link.style.color).toBe('rgb(153, 27, 27)'); // #991b1b
  });

  it('renders the rejection reason', () => {
    render(
      <JobRow
        variant="rejected"
        job={{
          id: 6,
          title: 'Senior Dev',
          url: 'https://example.com/job/6',
          reason: 'Missing required skills',
        }}
      />,
    );

    expect(screen.getByText('— Missing required skills')).toBeDefined();
  });

  it('handles empty rejection reason gracefully (does not crash)', () => {
    render(
      <JobRow
        variant="rejected"
        job={{
          id: 7,
          title: 'Empty Reason Role',
          url: 'https://example.com/job/7',
          reason: '',
        }}
      />,
    );

    // Should still render the title link without crashing
    const link = screen.getByRole('link', { name: 'Empty Reason Role' });
    expect(link).toBeDefined();
  });
});
