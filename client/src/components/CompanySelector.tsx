import { useCallback, useEffect, useRef, useState } from 'react';

interface CompanySelectorProps {
  token: string | null;
  onTokenChange: (token: string) => void;
  onAddClick: () => void;
  onDeleteClick: (token: string) => void;
  deleting: boolean;
}

export function CompanySelector({
  token,
  onTokenChange,
  onAddClick,
  onDeleteClick,
  deleting,
}: CompanySelectorProps) {
  const [companies, setCompanies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCompanies = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/companies')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load companies (${res.status})`);
        return res.json() as Promise<string[]>;
      })
      .then((tokens) => {
        if (!cancelled) {
          setCompanies(tokens);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Initial load
  useEffect(() => {
    const cancel = loadCompanies();
    return () => {
      cancel?.();
    };
  }, [loadCompanies]);

  // Re-load when deleting completes (detect transition from true→false)
  const prevDeleting = useRef(deleting);
  useEffect(() => {
    if (prevDeleting.current && !deleting) {
      loadCompanies();
    }
    prevDeleting.current = deleting;
  }, [deleting, loadCompanies]);

  if (loading) {
    return <span>Loading companies…</span>;
  }

  if (error) {
    return <span style={{ color: 'red' }}>{error}</span>;
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <select
        value={token ?? ''}
        onChange={(e) => onTokenChange(e.target.value)}
        style={{ padding: '0.3rem 0.5rem' }}
      >
        <option value="" disabled>
          Select a company…
        </option>
        {companies.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <button
        style={{
          padding: '0.3rem 0.6rem',
          cursor: 'pointer',
          border: '1px solid #2ecc71',
          borderRadius: '4px',
          background: '#fff',
          color: '#2ecc71',
          fontWeight: 600,
          fontSize: '0.85rem',
        }}
        onClick={onAddClick}
        title="Add a new company"
      >
        ＋ Add
      </button>

      {token && companies.includes(token) && (
        <button
          style={{
            padding: '0.3rem 0.6rem',
            cursor: 'pointer',
            border: '1px solid #e74c3c',
            borderRadius: '4px',
            background: '#fff',
            color: '#e74c3c',
            fontWeight: 600,
            fontSize: '0.85rem',
            opacity: deleting ? 0.5 : 1,
          }}
          onClick={() => {
            if (
              window.confirm(
                `Delete company "${token}"?\n\nThis will permanently remove the config file. This action cannot be undone.`,
              )
            ) {
              onDeleteClick(token);
            }
          }}
          disabled={deleting}
          title="Delete the selected company"
        >
          {deleting ? '…' : '🗑 Delete'}
        </button>
      )}
    </span>
  );
}
