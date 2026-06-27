/**
 * ConfigEditor
 *
 * Fetches the company config and skills profile for the selected company,
 * renders them as editable fields, saves via PUT endpoints, displays server
 * validation errors inline, and tracks unsaved changes via a callback.
 *
 * Also fetches discovered locations and departments from the Greenhouse API
 * for the selected company and shows them as clickable chip badges.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SectionHeaders {
  must_have: string[];
  nice_to_have: string[];
}

interface CompanyConfig {
  name: string;
  departments: string[];
  location: string;
  keyword: string;
  sectionHeaders: SectionHeaders;
}

type JobStrength = 'must_have' | 'nice_to_have' | 'preferred';

interface SkillEntry {
  name: string;
  strength: JobStrength;
  aliases?: string[];
}

interface SkillsProfile {
  skills: SkillEntry[];
  gapThreshold: number;
}

interface DiscoverData {
  locations: string[];
  departments: string[];
}

export interface ConfigEditorProps {
  /** Selected company token (null when none selected). */
  token: string | null;
  /** Called whenever unsaved-changes state changes. */
  onUnsavedChanges: (dirty: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shallowEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Parse a comma-separated string into a deduplicated, trimmed string array. */
function parseDepartments(raw: string): string[] {
  return [...new Set(raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  )];
}

const STRENGTH_OPTIONS: JobStrength[] = ['must_have', 'nice_to_have', 'preferred'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfigEditor({ token, onUnsavedChanges }: ConfigEditorProps) {
  // ── Fetch state ────────────────────────────────────────────────────────
  const [_companyConfig, setCompanyConfig] = useState<CompanyConfig | null>(null);
  const [_skillsProfile, setSkillsProfile] = useState<SkillsProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Edit buffers (local copies) ───────────────────────────────────────
  const [editCompany, setEditCompany] = useState<CompanyConfig | null>(null);
  const [editProfile, setEditProfile] = useState<SkillsProfile | null>(null);

  // ── Raw departments string (decouples input UX from array model) ──────
  const [rawDepartments, setRawDepartments] = useState('');

  // ── Save state ────────────────────────────────────────────────────────
  const [saving, setSaving] = useState<'company' | 'profile' | null>(null);
  const [_saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  // ── Server-error detail per section ───────────────────────────────────
  const [companySaveError, setCompanySaveError] = useState<string | null>(null);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);

  // ── Discovery state ───────────────────────────────────────────────────
  const [discoverData, setDiscoverData] = useState<DiscoverData | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  // ── Suggest-aliases state (per-skill-index loading / error) ──────────
  const [suggestingIndex, setSuggestingIndex] = useState<number | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // ── Suggest-keywords state ───────────────────────────────────────────
  const [suggestingKeywords, setSuggestingKeywords] = useState(false);
  const [suggestKeywordsError, setSuggestKeywordsError] = useState<string | null>(null);
  const [suggestedKeywords, setSuggestedKeywords] = useState<string[]>([]);

  // Track pristine snapshot to compute dirty flag
  const pristineCompany = useRef<CompanyConfig | null>(null);
  const pristineProfile = useRef<SkillsProfile | null>(null);

  // ── Dirty detection ───────────────────────────────────────────────────
  const isCompanyDirty =
    editCompany !== null && pristineCompany.current !== null
      ? !shallowEqual(editCompany, pristineCompany.current)
      : false;

  const isProfileDirty =
    editProfile !== null && pristineProfile.current !== null
      ? !shallowEqual(editProfile, pristineProfile.current)
      : false;

  const dirty = isCompanyDirty || isProfileDirty;

  useEffect(() => {
    onUnsavedChanges(dirty);
  }, [dirty, onUnsavedChanges]);

  // ── Fetch data when token changes ─────────────────────────────────────
  useEffect(() => {
    if (!token) {
      setCompanyConfig(null);
      setSkillsProfile(null);
      setEditCompany(null);
      setEditProfile(null);
      setRawDepartments('');
      pristineCompany.current = null;
      pristineProfile.current = null;
      setFetchError(null);
      setSaveErrors({});
      setCompanySaveError(null);
      setProfileSaveError(null);
      setDiscoverData(null);
      setDiscoverError(null);
      setSuggestedKeywords([]);
      setSuggestKeywordsError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    setSaveErrors({});
    setCompanySaveError(null);
    setProfileSaveError(null);

    Promise.all([
      fetch(`/api/config/company/${encodeURIComponent(token)}`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load company config (${r.status})`);
        return r.json() as Promise<CompanyConfig>;
      }),
      fetch('/api/config/profile').then((r) => {
        if (!r.ok) throw new Error(`Failed to load skills profile (${r.status})`);
        return r.json() as Promise<SkillsProfile>;
      }),
    ])
      .then(([company, profile]) => {
        if (cancelled) return;
        setCompanyConfig(company);
        setSkillsProfile(profile);
        setEditCompany(structuredClone(company));
        setEditProfile(structuredClone(profile));
        setRawDepartments(company.departments.join(', '));
        pristineCompany.current = structuredClone(company);
        pristineProfile.current = structuredClone(profile);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setFetchError(err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // ── Fetch discover data when token changes ────────────────────────────
  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    setDiscoverLoading(true);
    setDiscoverError(null);

    fetch(`/api/discover/${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Discover API returned ${r.status}`);
        return r.json() as Promise<DiscoverData>;
      })
      .then((data) => {
        if (cancelled) return;
        setDiscoverData(data);
        setDiscoverLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setDiscoverError(err.message);
        setDiscoverLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // ── Handlers: company config ──────────────────────────────────────────

  const handleCompanyNameChange = useCallback(
    (value: string) => {
      setEditCompany((prev) => (prev ? { ...prev, name: value } : prev));
      setCompanySaveError(null);
    },
    [],
  );

  const handleLocationChange = useCallback(
    (value: string) => {
      setEditCompany((prev) => (prev ? { ...prev, location: value } : prev));
      setCompanySaveError(null);
    },
    [],
  );

  const handleKeywordChange = useCallback(
    (value: string) => {
      setEditCompany((prev) => (prev ? { ...prev, keyword: value } : prev));
      setCompanySaveError(null);
    },
    [],
  );

  const handleDepartmentsChange = useCallback(
    (value: string) => {
      setRawDepartments(value);
      setEditCompany((prev) => {
        if (!prev) return prev;
        return { ...prev, departments: parseDepartments(value) };
      });
      setCompanySaveError(null);
    },
    [],
  );

  const handleMustHaveHeadersChange = useCallback(
    (value: string) => {
      const headers = value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      setEditCompany((prev) =>
        prev
          ? {
              ...prev,
              sectionHeaders: { ...prev.sectionHeaders, must_have: headers },
            }
          : prev,
      );
      setCompanySaveError(null);
    },
    [],
  );

  const handleNiceToHaveHeadersChange = useCallback(
    (value: string) => {
      const headers = value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      setEditCompany((prev) =>
        prev
          ? {
              ...prev,
              sectionHeaders: { ...prev.sectionHeaders, nice_to_have: headers },
            }
          : prev,
      );
      setCompanySaveError(null);
    },
    [],
  );

  const saveCompanyConfig = useCallback(async () => {
    if (!editCompany || !token) return;

    // Parse departments from the raw string before saving
    const deps = parseDepartments(rawDepartments);
    const payload = { ...editCompany, departments: deps };

    setSaving('company');
    setCompanySaveError(null);
    setSaveErrors((prev) => ({ ...prev, company: '' }));

    try {
      const res = await fetch(`/api/config/company/${encodeURIComponent(token)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail = body.detail ?? body.error ?? `Save failed (${res.status})`;
        setCompanySaveError(detail);
        return;
      }

      const saved: CompanyConfig = await res.json();
      setCompanyConfig(saved);
      setEditCompany(structuredClone(saved));
      setRawDepartments(saved.departments.join(', '));
      pristineCompany.current = structuredClone(saved);
      setCompanySaveError(null);
    } catch (err) {
      setCompanySaveError(String(err));
    } finally {
      setSaving(null);
    }
  }, [editCompany, token, rawDepartments]);

  // ── Handlers: skills profile ──────────────────────────────────────────

  const handleSkillNameChange = useCallback(
    (index: number, value: string) => {
      setEditProfile((prev) => {
        if (!prev) return prev;
        const skills = [...prev.skills];
        skills[index] = { ...skills[index], name: value };
        return { ...prev, skills };
      });
      setProfileSaveError(null);
    },
    [],
  );

  const handleSkillStrengthChange = useCallback(
    (index: number, value: JobStrength) => {
      setEditProfile((prev) => {
        if (!prev) return prev;
        const skills = [...prev.skills];
        skills[index] = { ...skills[index], strength: value };
        return { ...prev, skills };
      });
      setProfileSaveError(null);
    },
    [],
  );

  const handleSkillAliasesChange = useCallback(
    (index: number, value: string) => {
      setEditProfile((prev) => {
        if (!prev) return prev;
        const skills = [...prev.skills];
        const aliases = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        skills[index] = {
          ...skills[index],
          aliases: aliases.length > 0 ? aliases : undefined,
        };
        return { ...prev, skills };
      });
      setProfileSaveError(null);
    },
    [],
  );

  const handleSuggestAliases = useCallback(
    async (index: number, skillName: string) => {
      if (!skillName.trim()) return;

      setSuggestingIndex(index);
      setSuggestError(null);

      try {
        const res = await fetch('/api/config/profile/suggest-aliases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skillName: skillName.trim() }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const detail = body.detail ?? body.error ?? `Suggest failed (${res.status})`;
          setSuggestError(detail);
          return;
        }

        const data = (await res.json()) as { aliases: string[] };

        if (data.aliases.length > 0) {
          setEditProfile((prev) => {
            if (!prev) return prev;
            const skills = [...prev.skills];
            skills[index] = { ...skills[index], aliases: data.aliases };
            return { ...prev, skills };
          });
        }
      } catch (err) {
        setSuggestError(String(err));
      } finally {
        setSuggestingIndex(null);
      }
    },
    [],
  );

  const handleSuggestKeywords = useCallback(async () => {
    if (!token) return;

    setSuggestingKeywords(true);
    setSuggestKeywordsError(null);
    setSuggestedKeywords([]);

    try {
      const res = await fetch(
        `/api/config/company/${encodeURIComponent(token)}/suggest-keywords`,
        { method: 'POST' },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail =
          body.detail ?? body.error ?? `Suggest failed (${res.status})`;
        setSuggestKeywordsError(detail);
        return;
      }

      const data = (await res.json()) as { keywords: string[] };
      setSuggestedKeywords(data.keywords);
    } catch (err) {
      setSuggestKeywordsError(String(err));
    } finally {
      setSuggestingKeywords(false);
    }
  }, [token]);

  const handleAddSkill = useCallback(() => {
    setEditProfile((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        skills: [...prev.skills, { name: '', strength: 'nice_to_have' as JobStrength }],
      };
    });
    setProfileSaveError(null);
  }, []);

  const handleRemoveSkill = useCallback((index: number) => {
    setEditProfile((prev) => {
      if (!prev) return prev;
      const skills = prev.skills.filter((_, i) => i !== index);
      return { ...prev, skills };
    });
    setProfileSaveError(null);
  }, []);

  const handleGapThresholdChange = useCallback(
    (value: string) => {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        setEditProfile((prev) => (prev ? { ...prev, gapThreshold: num } : prev));
      }
      setProfileSaveError(null);
    },
    [],
  );

  const saveSkillsProfile = useCallback(async () => {
    if (!editProfile) return;
    setSaving('profile');
    setProfileSaveError(null);
    setSaveErrors((prev) => ({ ...prev, profile: '' }));

    try {
      const res = await fetch('/api/config/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editProfile),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail = body.detail ?? body.error ?? `Save failed (${res.status})`;
        setProfileSaveError(detail);
        return;
      }

      const saved: SkillsProfile = await res.json();
      setSkillsProfile(saved);
      setEditProfile(structuredClone(saved));
      pristineProfile.current = structuredClone(saved);
      setProfileSaveError(null);
    } catch (err) {
      setProfileSaveError(String(err));
    } finally {
      setSaving(null);
    }
  }, [editProfile]);

  // ── Render ────────────────────────────────────────────────────────────

  // No token selected
  if (!token) {
    return null;
  }

  // Loading
  if (loading) {
    return (
      <section
        style={{
          border: '1px solid #ccc',
          borderRadius: '6px',
          padding: '1rem',
          marginBottom: '1rem',
        }}
      >
        <p style={{ color: '#666' }}>Loading configuration…</p>
      </section>
    );
  }

  // Fetch error
  if (fetchError) {
    return (
      <section
        style={{
          border: '1px solid #e74c3c',
          borderRadius: '6px',
          padding: '1rem',
          marginBottom: '1rem',
        }}
      >
        <p style={{ color: '#e74c3c' }}>Error: {fetchError}</p>
      </section>
    );
  }

  // No data yet
  if (!editCompany || !editProfile) {
    return (
      <section
        style={{
          border: '1px solid #ccc',
          borderRadius: '6px',
          padding: '1rem',
          marginBottom: '1rem',
        }}
      >
        <p style={{ color: '#666' }}>No configuration data available.</p>
      </section>
    );
  }

  // ── Common styles ──────────────────────────────────────────────────────
  const sectionStyle: React.CSSProperties = {
    border: '1px solid #ddd',
    borderRadius: '6px',
    padding: '1rem',
    marginBottom: '1rem',
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
    marginTop: '0.25rem',
    whiteSpace: 'pre-wrap',
  };

  const saveButtonStyle: React.CSSProperties = {
    marginTop: '0.75rem',
    padding: '0.4rem 1rem',
    cursor: 'pointer',
  };

  const chipContainerStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.35rem',
    marginTop: '0.4rem',
  };

  const chipStyle: React.CSSProperties = {
    padding: '0.15rem 0.5rem',
    background: '#eef2ff',
    border: '1px solid #c7d2fe',
    borderRadius: '12px',
    fontSize: '0.78rem',
    cursor: 'pointer',
    color: '#4338ca',
    whiteSpace: 'nowrap',
  };

  return (
    <section style={{ marginBottom: '1rem' }}>
      <details open>
        <summary style={{ fontWeight: 700, fontSize: '1.1rem', cursor: 'pointer' }}>
          Configuration Editor
          {dirty && (
            <span style={{ color: '#e67e22', marginLeft: '0.75rem', fontSize: '0.85rem' }}>
              ⚠ Unsaved changes
            </span>
          )}
        </summary>

        {/* ──── Company Config ──── */}
        <div style={sectionStyle}>
          <h3 style={{ margin: 0 }}>Company Config</h3>

          <label style={labelStyle}>Company Name</label>
          <input
            style={inputStyle}
            value={editCompany.name}
            onChange={(e) => handleCompanyNameChange(e.target.value)}
          />

          <label style={labelStyle}>
            Location{' '}
            <span style={{ fontWeight: 400, color: '#888' }}>(substring match on job location; leave blank to skip)</span>
          </label>
          <input
            style={inputStyle}
            value={editCompany.location}
            onChange={(e) => handleLocationChange(e.target.value)}
            placeholder="e.g. San Francisco"
          />

          {/* Discovered locations */}
          {discoverLoading && (
            <p style={{ fontSize: '0.8rem', color: '#888', margin: '0.25rem 0 0' }}>
              Loading available locations…
            </p>
          )}
          {discoverError && (
            <p style={{ fontSize: '0.8rem', color: '#e74c3c', margin: '0.25rem 0 0' }}>
              Could not load discovery data: {discoverError}
            </p>
          )}
          {discoverData && discoverData.locations.length > 0 && (
            <div style={chipContainerStyle}>
              {discoverData.locations.map((loc) => (
                <span
                  key={loc}
                  style={chipStyle}
                  onClick={() => handleLocationChange(loc)}
                  title={`Click to set location to "${loc}"`}
                >
                  📍 {loc}
                </span>
              ))}
            </div>
          )}

          <label style={labelStyle}>
            Role Keyword{' '}
            <span style={{ fontWeight: 400, color: '#888' }}>(substring match on job title; leave blank to skip)</span>
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={editCompany.keyword}
              onChange={(e) => handleKeywordChange(e.target.value)}
              placeholder="e.g. Engineer"
            />
            <button
              style={{
                padding: '0.4rem 0.8rem',
                fontSize: '0.85rem',
                background: '#4a6fa5',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                opacity: suggestingKeywords ? 0.6 : 1,
              }}
              onClick={handleSuggestKeywords}
              disabled={suggestingKeywords}
              title="Suggest role keywords from live job titles using AI"
            >
              {suggestingKeywords ? '…' : 'Suggest'}
            </button>
          </div>

          {/* Suggest-keywords error */}
          {suggestKeywordsError && (
            <p style={{ ...errorStyle, marginTop: '0.25rem' }}>
              ⚠ {suggestKeywordsError}
            </p>
          )}

          {/* Suggested keyword chips */}
          {suggestedKeywords.length > 0 && (
            <div style={chipContainerStyle}>
              {suggestedKeywords.map((kw) => (
                <span
                  key={kw}
                  style={chipStyle}
                  onClick={() => handleKeywordChange(kw)}
                  title={`Click to set keyword to "${kw}"`}
                >
                  🔑 {kw}
                </span>
              ))}
            </div>
          )}

          <label style={labelStyle}>
            Departments{' '}
            <span style={{ fontWeight: 400, color: '#888' }}>(comma-separated)</span>
          </label>
          <input
            style={inputStyle}
            value={rawDepartments}
            onChange={(e) => handleDepartmentsChange(e.target.value)}
            placeholder="Engineering, Product, Design"
          />

          {/* Discovered departments */}
          {discoverData && discoverData.departments.length > 0 && (
            <div style={chipContainerStyle}>
              {discoverData.departments.map((dep) => (
                <span
                  key={dep}
                  style={chipStyle}
                  onClick={() => {
                    const current = rawDepartments.trim();
                    const newRaw = current ? `${current}, ${dep}` : dep;
                    handleDepartmentsChange(newRaw);
                  }}
                  title={`Click to append "${dep}" to departments`}
                >
                  🏢 {dep}
                </span>
              ))}
            </div>
          )}

          <label style={labelStyle}>
            Must-Have Section Headers{' '}
            <span style={{ fontWeight: 400, color: '#888' }}>(one per line)</span>
          </label>
          <textarea
            style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
            value={editCompany.sectionHeaders.must_have.join('\n')}
            onChange={(e) => handleMustHaveHeadersChange(e.target.value)}
            placeholder="About the role"
          />

          <label style={labelStyle}>
            Nice-to-Have Section Headers{' '}
            <span style={{ fontWeight: 400, color: '#888' }}>(one per line)</span>
          </label>
          <textarea
            style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
            value={editCompany.sectionHeaders.nice_to_have.join('\n')}
            onChange={(e) => handleNiceToHaveHeadersChange(e.target.value)}
            placeholder="Nice to have"
          />

          {companySaveError && <p style={errorStyle}>⚠ {companySaveError}</p>}

          <button
            style={saveButtonStyle}
            onClick={saveCompanyConfig}
            disabled={saving === 'company' || !isCompanyDirty}
            title={
              !isCompanyDirty
                ? 'No changes to save'
                : saving === 'company'
                  ? 'Saving…'
                  : 'Save company config'
            }
          >
            {saving === 'company' ? 'Saving…' : 'Save Company Config'}
          </button>
        </div>

        {/* ──── Skills Profile ──── */}
        <div style={sectionStyle}>
          <h3 style={{ margin: 0 }}>Skills Profile</h3>

          <label style={labelStyle}>
            Gap Threshold{' '}
            <span style={{ fontWeight: 400, color: '#888' }}>(0–1, exclusive)</span>
          </label>
          <input
            style={{ ...inputStyle, maxWidth: '200px' }}
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={editProfile.gapThreshold}
            onChange={(e) => handleGapThresholdChange(e.target.value)}
          />
          {editProfile.gapThreshold > 0 && editProfile.gapThreshold < 1 && (
            <p style={{ fontSize: '0.8rem', color: '#888', margin: '0.25rem 0 0' }}>
              Jobs where you match{' '}
              <strong>{'>'}{Math.round((1 - editProfile.gapThreshold) * 100)}%</strong>{' '}
              of must-have skills will pass to scoring.
            </p>
          )}

          <label style={labelStyle}>Skills</label>
          {suggestError && (
            <p style={{ ...errorStyle, marginBottom: '0.5rem' }}>⚠ {suggestError}</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {editProfile.skills.map((skill, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: '0.5rem',
                    alignItems: 'center',
                  }}
                >
                  <input
                    style={{ flex: 1, padding: '0.3rem 0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                    value={skill.name}
                    onChange={(e) => handleSkillNameChange(i, e.target.value)}
                    placeholder="Skill name"
                  />
                  <select
                    style={{ padding: '0.3rem 0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                    value={skill.strength}
                    onChange={(e) => handleSkillStrengthChange(i, e.target.value as JobStrength)}
                    title="Informational only — does not affect Stage 4 matching"
                  >
                    {STRENGTH_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  <button
                    style={{
                      padding: '0.3rem 0.6rem',
                      background: '#e74c3c',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                    onClick={() => handleRemoveSkill(i)}
                    title="Remove skill"
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    style={{
                      flex: 1,
                      padding: '0.25rem 0.4rem',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                    }}
                    value={skill.aliases?.join(', ') ?? ''}
                    onChange={(e) => handleSkillAliasesChange(i, e.target.value)}
                    placeholder="Aliases (comma-separated, e.g. TS, Typescript)"
                  />
                  <button
                    style={{
                      padding: '0.25rem 0.6rem',
                      fontSize: '0.8rem',
                      background: '#4a6fa5',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      opacity: suggestingIndex === i ? 0.6 : 1,
                    }}
                    onClick={() => handleSuggestAliases(i, skill.name)}
                    disabled={suggestingIndex === i || !skill.name.trim()}
                    title={
                      !skill.name.trim()
                        ? 'Enter a skill name first'
                        : 'Suggest aliases using AI'
                    }
                  >
                    {suggestingIndex === i ? '…' : 'Suggest'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            style={{
              marginTop: '0.5rem',
              padding: '0.3rem 0.8rem',
              cursor: 'pointer',
            }}
            onClick={handleAddSkill}
          >
            + Add Skill
          </button>

          {profileSaveError && <p style={errorStyle}>⚠ {profileSaveError}</p>}

          <div style={{ marginTop: '0.75rem' }}>
            <button
              style={saveButtonStyle}
              onClick={saveSkillsProfile}
              disabled={saving === 'profile' || !isProfileDirty}
              title={
                !isProfileDirty
                  ? 'No changes to save'
                  : saving === 'profile'
                    ? 'Saving…'
                    : 'Save skills profile'
              }
            >
              {saving === 'profile' ? 'Saving…' : 'Save Skills Profile'}
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
