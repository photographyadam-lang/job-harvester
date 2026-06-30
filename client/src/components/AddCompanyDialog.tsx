/**
 * AddCompanyDialog
 *
 * Modal dialog for creating a new company.  Prompts for a company key
 * (config filename stem), an optional Greenhouse board token (defaults to
 * the key), and a display name.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NewCompanyInput {
  token: string;
  config: {
    name: string;
    boardToken: string;
  };
}

export interface AddCompanyDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: NewCompanyInput) => Promise<string | null>; // returns error string or null on success
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddCompanyDialog({
  open,
  onClose,
  onCreate,
}: AddCompanyDialogProps) {
  const [token, setToken] = useState('');
  const [boardToken, setBoardToken] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenRef = useRef<HTMLInputElement>(null);

  // Reset form when opened
  useEffect(() => {
    if (open) {
      setToken('');
      setBoardToken('');
      setName('');
      setError(null);
      setLoading(false);
      // Focus the first field after render
      setTimeout(() => tokenRef.current?.focus(), 50);
    }
  }, [open]);

  const handleTokenChange = useCallback(
    (value: string) => {
      setToken(value);
      setError(null);
      // Auto-fill board token and name if they haven't been manually set
      setBoardToken((prev) => (prev === '' || prev === token ? value : prev));
      setName((prev) => (prev === '' || prev === token ? value : prev));
    },
    [token],
  );

  const handleCreate = useCallback(async () => {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setError('Company key is required.');
      return;
    }

    setLoading(true);
    setError(null);

    const err = await onCreate({
      token: trimmedToken,
      config: {
        name: name.trim() || trimmedToken,
        boardToken: boardToken.trim(),
      },
    });

    if (err) {
      setError(err);
      setLoading(false);
    } else {
      onClose();
    }
  }, [token, boardToken, name, onCreate, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !loading) {
        handleCreate();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleCreate, onClose, loading],
  );

  if (!open) return null;

  const backdropStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const dialogStyle: React.CSSProperties = {
    background: '#fff',
    borderRadius: '8px',
    padding: '1.5rem',
    width: '400px',
    maxWidth: '90vw',
    boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontWeight: 600,
    marginBottom: '0.25rem',
    marginTop: '0.75rem',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.4rem 0.5rem',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '0.9rem',
    boxSizing: 'border-box',
  };

  const errorStyle: React.CSSProperties = {
    color: '#e74c3c',
    fontSize: '0.85rem',
    marginTop: '0.5rem',
  };

  return (
    <div style={backdropStyle} onClick={onClose} onKeyDown={handleKeyDown}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 0.5rem' }}>Add Company</h3>

        <label style={labelStyle}>
          Company Key{' '}
          <span style={{ fontWeight: 400, color: '#888' }}>
            (used as the config filename)
          </span>
        </label>
        <input
          ref={tokenRef}
          style={inputStyle}
          value={token}
          onChange={(e) => handleTokenChange(e.target.value)}
          placeholder="e.g. my-startup"
          disabled={loading}
        />

        <label style={labelStyle}>
          Greenhouse Board Token{' '}
          <span style={{ fontWeight: 400, color: '#888' }}>
            (leave blank to use the company key)
          </span>
        </label>
        <input
          style={inputStyle}
          value={boardToken}
          onChange={(e) => {
            setBoardToken(e.target.value);
            setError(null);
          }}
          placeholder={token || 'e.g. my-startup-inc'}
          disabled={loading}
        />

        <label style={labelStyle}>Company Name</label>
        <input
          style={inputStyle}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder={token || 'e.g. My Startup, Inc.'}
          disabled={loading}
        />

        {error && <p style={errorStyle}>⚠ {error}</p>}

        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            justifyContent: 'flex-end',
            marginTop: '1rem',
          }}
        >
          <button
            style={{
              padding: '0.4rem 1rem',
              cursor: 'pointer',
              border: '1px solid #ccc',
              borderRadius: '4px',
              background: '#f5f5f5',
            }}
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            style={{
              padding: '0.4rem 1rem',
              cursor: 'pointer',
              border: 'none',
              borderRadius: '4px',
              background: loading ? '#95a5a6' : '#2ecc71',
              color: '#fff',
              fontWeight: 600,
            }}
            onClick={handleCreate}
            disabled={loading}
          >
            {loading ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
