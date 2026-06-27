/**
 * JobRow
 *
 * Renders a single job as a list item with a clickable title link.
 * Passed jobs render in green; rejected jobs render in red with a reason.
 */

interface JobRowPassedVariant {
  variant: 'passed';
  job: {
    id: number;
    title: string;
    url: string;
  };
}

interface JobRowRejectedVariant {
  variant: 'rejected';
  job: {
    id: number;
    title: string;
    url: string;
    reason: string;
  };
}

type JobRowProps = JobRowPassedVariant | JobRowRejectedVariant;

export function JobRow(props: JobRowProps) {
  const { variant, job } = props;

  const linkStyle: React.CSSProperties = {
    color: variant === 'passed' ? '#166534' : '#991b1b',
    textDecoration: 'none',
    fontWeight: 500,
  };

  return (
    <li
      style={{
        padding: '0.25rem 0',
        listStyle: 'none',
      }}
    >
      <a href={job.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
        {job.title}
      </a>
      {'reason' in job && job.reason && (
        <span style={{ color: '#991b1b', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
          — {job.reason}
        </span>
      )}
    </li>
  );
}
