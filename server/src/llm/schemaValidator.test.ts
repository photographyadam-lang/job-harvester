/**
 * SchemaValidator tests
 *
 * @jest-environment node
 */

import {
  validateSchema,
  extractionSchema,
  scoreSchema,
  LlmSchemaError,
} from './schemaValidator';

// ---------------------------------------------------------------------------
// Tests — extraction schema
// ---------------------------------------------------------------------------

describe('extractionSchema', () => {
  // 1. Valid extraction schema
  test('valid extraction schema passes', () => {
    const data = {
      must_haves: ['React', 'TypeScript'],
      nice_to_haves: ['GraphQL'],
      years_experience_required: 3,
    };
    expect(() => validateSchema(data, extractionSchema, 'extraction')).not.toThrow();
  });

  // 2. Missing must_haves
  test('missing must_haves throws LlmSchemaError', () => {
    const data = {
      nice_to_haves: ['GraphQL'],
      years_experience_required: 3,
    };
    expect(() => validateSchema(data, extractionSchema, 'extraction')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, extractionSchema, 'extraction');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('must_haves');
      expect(err.expected).toContain('array');
    }
  });

  // 3. Wrong type for years_experience_required
  test('wrong type for years_experience_required throws LlmSchemaError', () => {
    const data = {
      must_haves: ['React'],
      nice_to_haves: [],
      years_experience_required: 'three',
    };
    expect(() => validateSchema(data, extractionSchema, 'extraction')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, extractionSchema, 'extraction');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('years_experience_required');
    }
  });

  // 4. Null years_experience_required
  test('null years_experience_required passes', () => {
    const data = {
      must_haves: ['React'],
      nice_to_haves: [],
      years_experience_required: null,
    };
    expect(() => validateSchema(data, extractionSchema, 'extraction')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests — score schema
// ---------------------------------------------------------------------------

describe('scoreSchema', () => {
  // 5. Valid score schema
  test('valid score schema passes', () => {
    const data = {
      score: 8,
      scoreReasoning: 'Strong match across must-have skills',
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).not.toThrow();
  });

  // 6. Score out of range (>10)
  test('score out of range (>10) throws LlmSchemaError', () => {
    const data = {
      score: 15,
      scoreReasoning: 'Exceeds maximum',
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, scoreSchema, 'score');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('score');
      expect(err.expected).toContain('10');
    }
  });

  // 7. Empty scoreReasoning
  test('empty scoreReasoning throws LlmSchemaError', () => {
    const data = {
      score: 7,
      scoreReasoning: '',
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, scoreSchema, 'score');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('scoreReasoning');
    }
  });
});
