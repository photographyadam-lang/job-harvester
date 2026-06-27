import { useEffect, useState } from 'react';

interface CompanySelectorProps {
  token: string | null;
  onTokenChange: (token: string) => void;
}

export function CompanySelector({ token, onTokenChange }: CompanySelectorProps) {
  const [companies, setCompanies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  if (loading) {
    return <span>Loading companies…</span>;
  }

  if (error) {
    return <span style={{ color: 'red' }}>{error}</span>;
  }

  return (
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
  );
}
