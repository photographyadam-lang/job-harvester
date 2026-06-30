# Role Keyword Improvements — Implementation Plan

## Summary

Two changes to the Role Keyword feature:

1. **LLM prompt overhaul** — extract both generic role/level descriptions AND domain/specializations from job titles (instead of suppressing role-level words)
2. **UI dropdown** — replace plain text input with `<input>` + `<datalist>` combo so users can pick from suggested keywords

---

## File-by-File Change Details

### 1. `server/src/routes/config.ts` — Lines 272–368

**Change:** Rewrite the suggest-keywords prompt and response shape.

**Current response shape:**
```json
{ "keywords": ["Product Design", "Data Platform"] }
```

**New response shape:**
```json
{
  "roles": ["Software Engineer", "Manager", "Director", "Analyst"],
  "specializations": ["Machine Learning", "Security Operations", "Product Design"]
}
```

**New prompt guidance:**

```
Given the following list of job titles from a company's careers page,
decompose each title into two components and return them as separate,
deduplicated lists:

1. ROLES: The generic role or level description — the part that describes
   the job function independent of domain. Examples:
   - "Software Engineer", "Manager", "Director", "Head", "Senior",
     "Lead", "Partner", "Specialist", "Analyst", "Project Manager",
     "Associate", "Consultant", "Designer", "Scientist", "Architect",
     "Developer", "Administrator", "Coordinator"
   - Include seniority modifiers when they are part of the role
     (e.g. "Senior Software Engineer", "Junior Analyst")
   - Deduplicate this list — return each unique role once

2. SPECIALIZATIONS: The domain or functional specialty — the part that
   describes what area the role focuses on. Examples:
   - "Machine Learning", "Security Operations", "Product Design",
     "Data Engineering", "Revenue Operations", "Infrastructure"
   - DO NOT include generic role-level words here
   - DO NOT include company names or location-based terms
   - Each specialization should be 1-4 words
   - Deduplicate this list — return each unique specialization once

...

Return ONLY a JSON object with "roles" and "specializations" arrays:
{"roles":["Software Engineer","Data Scientist"],"specializations":["Machine Learning","Platform"]}
```

**Schema update:**
```typescript
const schema = {
  type: 'object' as const,
  properties: {
    roles: { type: 'array' as const, items: { type: 'string' as const } },
    specializations: { type: 'array' as const, items: { type: 'string' as const } },
  },
  required: ['roles', 'specializations'],
};
```

**Response:**
```typescript
const parsed = JSON.parse(response.content) as {
  roles: string[];
  specializations: string[];
};
res.json({ roles: parsed.roles, specializations: parsed.specializations });
```

---

### 2. `server/src/routes/config.test.ts` — Lines 85–254

**Changes:**

- All mock `callDeepSeek` responses updated from `{ keywords: [...] }` to `{ roles: [...], specializations: [...] }`
- Assertions updated to check for `res.body.roles` and `res.body.specializations`
- Prompt-content assertions updated to verify new two-category instructions
- Test names updated to reflect new behavior
- The "returns empty keywords array" test becomes "returns empty arrays when no patterns found"
- The schema validation error test (`LlmSchemaError`) — the error message references the field name, so update accordingly

**Test cases to update:**

| Current Test | Change |
|---|---|
| `returns keywords from DeepSeek based on fetched job titles` | Update mock response shape, assert `res.body.roles` and `res.body.specializations` |
| `deduplicates identical job titles before sending to DeepSeek` | Update mock response shape, assert prompt contains deduped titles |
| `returns 502 when Greenhouse API fails` | No change needed (error path unchanged) |
| `returns 502 when DeepSeek API fails` | No change needed |
| `returns 502 when DeepSeek response fails schema validation` | No change needed (still catches schema errors) |
| `returns empty keywords array when DeepSeek finds no patterns` | Update mock to `{ roles: [], specializations: [] }`, assert both empty |
| `returns 500 for unexpected errors` | No change needed |

---

### 3. `client/src/components/ConfigEditor.tsx`

**State changes (lines 112–114):**

Replace:
```typescript
const [suggestedKeywords, setSuggestedKeywords] = useState<string[]>([]);
```

With:
```typescript
interface SuggestedKeywords {
  roles: string[];
  specializations: string[];
}
const [suggestedKeywords, setSuggestedKeywords] = useState<SuggestedKeywords>({ roles: [], specializations: [] });
```

**`handleSuggestKeywords` (lines 436–464):**

Replace:
```typescript
const data = (await res.json()) as { keywords: string[] };
setSuggestedKeywords(data.keywords);
```

With:
```typescript
const data = (await res.json()) as SuggestedKeywords;
setSuggestedKeywords(data);
```

**UI changes (lines 699–755):**

Replace the text `<input>` with an `<input>` + `<datalist>` combo:

```tsx
<label style={labelStyle}>
  Role Keyword{' '}
  <span style={{ fontWeight: 400, color: '#888' }}>
    (substring match on job title; leave blank to skip)
  </span>
</label>
<div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
  <input
    style={{ ...inputStyle, flex: 1 }}
    value={editCompany.keyword}
    onChange={(e) => handleKeywordChange(e.target.value)}
    placeholder="e.g. Engineer"
    list="keyword-suggestions"
  />
  <datalist id="keyword-suggestions">
    {suggestedKeywords.roles.length > 0 && (
      <optgroup label="Roles / Levels">
        {suggestedKeywords.roles.map((kw) => (
          <option key={`role-${kw}`} value={kw} />
        ))}
      </optgroup>
    )}
    {suggestedKeywords.specializations.length > 0 && (
      <optgroup label="Specializations / Domains">
        {suggestedKeywords.specializations.map((kw) => (
          <option key={`spec-${kw}`} value={kw} />
        ))}
      </optgroup>
    )}
  </datalist>
  <button ... Suggest button unchanged ... />
</div>
```

Replace the suggested keyword chips (lines 738–755) to render from the new shape:

```tsx
{suggestedKeywords.roles.length > 0 && (
  <div style={chipContainerStyle}>
    <span style={{ fontSize: '0.75rem', color: '#888', marginRight: '0.25rem' }}>
      Roles:
    </span>
    {suggestedKeywords.roles.map((kw) => (
      <span key={`role-${kw}`} style={chipStyle}
        onClick={() => handleKeywordChange(kw)}
        title={`Click to set keyword to "${kw}"`}>
        🔑 {kw}
      </span>
    ))}
  </div>
)}
{suggestedKeywords.specializations.length > 0 && (
  <div style={chipContainerStyle}>
    <span style={{ fontSize: '0.75rem', color: '#888', marginRight: '0.25rem' }}>
      Specializations:
    </span>
    {suggestedKeywords.specializations.map((kw) => (
      <span key={`spec-${kw}`} style={chipStyle}
        onClick={() => handleKeywordChange(kw)}
        title={`Click to set keyword to "${kw}"`}>
        🔑 {kw}
      </span>
    ))}
  </div>
)}
```

Note: Chip clicks now **replace** the keyword value (not append), since the `<datalist>` dropdown handles single selection naturally.

**Reset on token change (line 153):**

Replace `setSuggestedKeywords([])` with `setSuggestedKeywords({ roles: [], specializations: [] })`.

---

## Execution Order

1. Update `server/src/routes/config.ts` — prompt + schema + response shape
2. Update `server/src/routes/config.test.ts` — tests for new behavior
3. Run `npm test --workspace=server` to confirm tests pass
4. Update `client/src/components/ConfigEditor.tsx` — state + UI + handlers
5. Run `npm run build --workspace=server` to confirm build passes
6. Manual smoke test: select a company, click Suggest, verify dropdown appears with Roles and Specializations groups

---

## What does NOT change

- `CompanyConfig.keyword` remains a `string` (comma-separated values)
- `FilterConfig.keyword` remains a `string`
- `stage2-filter.ts` comma-split OR logic unchanged
- `companyConfig.ts` validation unchanged
- `orchestrator.ts` FilterConfig assembly unchanged
- Config files on disk backward compatible
- The `DiscoverData` interface (locations + departments only)
