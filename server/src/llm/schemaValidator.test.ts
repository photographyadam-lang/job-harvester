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
  ValidationSchema,
} from './schemaValidator';

// ---------------------------------------------------------------------------
// Tests — LlmSchemaError
// ---------------------------------------------------------------------------

describe('LlmSchemaError', () => {
  test('LlmSchemaError has correct name, field, expected, actual', () => {
    const err = new LlmSchemaError('score', 'number >= 1', '0');
    expect(err.name).toBe('LlmSchemaError');
    expect(err.field).toBe('score');
    expect(err.expected).toBe('number >= 1');
    expect(err.actual).toBe('0');
    expect(err.message).toContain('score');
    expect(err.message).toContain('number >= 1');
    expect(err.message).toContain('0');
  });

  test('LlmSchemaError is instanceof Error', () => {
    const err = new LlmSchemaError('f', 'string', 'number');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LlmSchemaError);
  });
});

// ---------------------------------------------------------------------------
// Tests — root validation (line 152)
// ---------------------------------------------------------------------------

describe('validateSchema — root validation', () => {
  test('throws LlmSchemaError when data is null', () => {
    expect(() => validateSchema(null, extractionSchema, 'extraction')).toThrow(LlmSchemaError);
    try {
      validateSchema(null, extractionSchema, 'extraction');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('(root)');
      expect(err.expected).toBe('object');
      expect(err.actual).toBe('null');
    }
  });

  test('throws LlmSchemaError when data is a string', () => {
    expect(() => validateSchema('hello', extractionSchema, 'extraction')).toThrow(LlmSchemaError);
    try {
      validateSchema('hello', extractionSchema, 'extraction');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('(root)');
      expect(err.expected).toBe('object');
      expect(err.actual).toBe('string');
    }
  });

  test('throws LlmSchemaError when data is a number', () => {
    expect(() => validateSchema(42, extractionSchema, 'extraction')).toThrow(LlmSchemaError);
    try {
      validateSchema(42, extractionSchema, 'extraction');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('(root)');
      expect(err.expected).toBe('object');
      expect(err.actual).toBe('number');
    }
  });

  test('throws LlmSchemaError when data is undefined', () => {
    expect(() => validateSchema(undefined, scoreSchema, 'score')).toThrow(LlmSchemaError);
    try {
      validateSchema(undefined, scoreSchema, 'score');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('(root)');
      expect(err.expected).toBe('object');
      expect(err.actual).toBe('undefined');
    }
  });
});

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

  // 3. Missing nice_to_haves
  test('missing nice_to_haves throws LlmSchemaError', () => {
    const data = {
      must_haves: ['React'],
      years_experience_required: 3,
    };
    expect(() => validateSchema(data, extractionSchema, 'extraction')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, extractionSchema, 'extraction');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('nice_to_haves');
      expect(err.actual).toBe('undefined');
    }
  });

  // 4. Missing optional field passes
  test('missing optional years_experience_required passes', () => {
    const data = {
      must_haves: ['React'],
      nice_to_haves: [],
    };
    expect(() => validateSchema(data, extractionSchema, 'extraction')).not.toThrow();
  });

  // 5. Wrong type for years_experience_required
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

  // 6. Null years_experience_required passes
  test('null years_experience_required passes', () => {
    const data = {
      must_haves: ['React'],
      nice_to_haves: [],
      years_experience_required: null,
    };
    expect(() => validateSchema(data, extractionSchema, 'extraction')).not.toThrow();
  });

  // 7. Null on non-nullable field throws (line 179-183)
  test('null must_haves throws LlmSchemaError', () => {
    const data = {
      must_haves: null,
      nice_to_haves: [],
    };
    expect(() => validateSchema(data, extractionSchema, 'extraction')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, extractionSchema, 'extraction');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('must_haves');
      expect(err.actual).toBe('null');
      // must_haves type is 'array' (not ['array']), and 'null' is not in it
    }
  });

  // 8. Array item type mismatch (line 204)
  test('must_haves with non-string items throws LlmSchemaError', () => {
    const data = {
      must_haves: ['React', 123, 'TypeScript'],
      nice_to_haves: [],
    };
    expect(() => validateSchema(data, extractionSchema, 'extraction')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, extractionSchema, 'extraction');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('must_haves[1]');
      expect(err.expected).toBe('string');
      expect(err.actual).toBe('number');
    }
  });

  // 9. nice_to_haves with null items
  test('nice_to_haves with null items throws LlmSchemaError', () => {
    const data = {
      must_haves: ['React'],
      nice_to_haves: ['GraphQL', null],
    };
    expect(() => validateSchema(data, extractionSchema, 'extraction')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, extractionSchema, 'extraction');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('nice_to_haves[1]');
      expect(err.expected).toBe('string');
      expect(err.actual).toBe('null');
    }
  });

  // 10. must_haves with wrong type (object instead of array)
  test('must_haves as object throws LlmSchemaError', () => {
    const data = {
      must_haves: { React: true },
      nice_to_haves: [],
    };
    expect(() => validateSchema(data, extractionSchema, 'extraction')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, extractionSchema, 'extraction');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('must_haves');
      // describeExpectedType should produce "array of string"
      expect(err.expected).toContain('array of string');
      expect(err.actual).toBe('object');
    }
  });

  // 11. Extra unexpected fields are ignored
  test('extra unexpected fields are ignored', () => {
    const data = {
      must_haves: ['React'],
      nice_to_haves: [],
      extra_field: 'should be ignored',
      another: 42,
    };
    expect(() => validateSchema(data, extractionSchema, 'extraction')).not.toThrow();
  });

  // 12. Both arrays empty is valid
  test('both must_haves and nice_to_haves empty arrays pass', () => {
    const data = {
      must_haves: [],
      nice_to_haves: [],
    };
    expect(() => validateSchema(data, extractionSchema, 'extraction')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests — score schema
// ---------------------------------------------------------------------------

describe('scoreSchema', () => {
  // 13. Valid score schema
  test('valid score schema passes', () => {
    const data = {
      score: 8,
      scoreReasoning: 'Strong match across must-have skills',
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).not.toThrow();
  });

  // 14. Score out of range (>10)
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

  // 15. Score below minimum (line 216)
  test('score below minimum (<1) throws LlmSchemaError', () => {
    const data = {
      score: 0,
      scoreReasoning: 'Below minimum',
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, scoreSchema, 'score');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('score');
      expect(err.expected).toContain('>= 1');
      expect(err.actual).toBe('0');
    }
  });

  // 16. Score at boundary (1) passes
  test('score at minimum boundary (1) passes', () => {
    const data = {
      score: 1,
      scoreReasoning: 'Barely a match',
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).not.toThrow();
  });

  // 17. Score at boundary (10) passes
  test('score at maximum boundary (10) passes', () => {
    const data = {
      score: 10,
      scoreReasoning: 'Perfect match',
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).not.toThrow();
  });

  // 18. Empty scoreReasoning
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

  // 19. Whitespace-only scoreReasoning
  test('whitespace-only scoreReasoning throws LlmSchemaError', () => {
    const data = {
      score: 7,
      scoreReasoning: '   ',
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, scoreSchema, 'score');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('scoreReasoning');
      expect(err.expected).toContain('non-empty');
    }
  });

  // 20. Wrong type for score triggers describeExpectedType with min/max (lines 268-271)
  test('score as string triggers describeExpectedType with range constraints', () => {
    const data = {
      score: 'eight',
      scoreReasoning: 'Some reasoning',
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, scoreSchema, 'score');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('score');
      // describeExpectedType should produce "number (>= 1, <= 10)"
      expect(err.expected).toContain('number');
      expect(err.expected).toContain('>= 1');
      expect(err.expected).toContain('<= 10');
      expect(err.actual).toBe('string');
    }
  });

  // 21. Wrong type for scoreReasoning triggers describeExpectedType with notEmpty (line 274)
  test('scoreReasoning as number triggers describeExpectedType with non-empty constraint', () => {
    const data = {
      score: 5,
      scoreReasoning: 123,
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, scoreSchema, 'score');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('scoreReasoning');
      // describeExpectedType should produce "string (non-empty)"
      expect(err.expected).toContain('string');
      expect(err.expected).toContain('non-empty');
      expect(err.actual).toBe('number');
    }
  });

  // 22. Missing score
  test('missing score throws LlmSchemaError', () => {
    const data = {
      scoreReasoning: 'Missing score field',
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, scoreSchema, 'score');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('score');
      expect(err.actual).toBe('undefined');
    }
  });

  // 23. Missing scoreReasoning
  test('missing scoreReasoning throws LlmSchemaError', () => {
    const data = {
      score: 5,
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, scoreSchema, 'score');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('scoreReasoning');
      expect(err.actual).toBe('undefined');
    }
  });

  // 24. Null score throws (score has no nullable, 'null' not in type)
  test('null score throws LlmSchemaError', () => {
    const data = {
      score: null,
      scoreReasoning: 'Score is null',
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, scoreSchema, 'score');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('score');
      expect(err.actual).toBe('null');
    }
  });

  // 25. Null scoreReasoning throws (string type, not nullable)
  test('null scoreReasoning throws LlmSchemaError', () => {
    const data = {
      score: 5,
      scoreReasoning: null,
    };
    expect(() => validateSchema(data, scoreSchema, 'score')).toThrow(LlmSchemaError);
    try {
      validateSchema(data, scoreSchema, 'score');
    } catch (e) {
      const err = e as LlmSchemaError;
      expect(err.field).toBe('scoreReasoning');
      expect(err.actual).toBe('null');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — custom schema edge cases
// ---------------------------------------------------------------------------

describe('validateSchema — custom schema edge cases', () => {
  // 26. Field with type array that includes 'null' but nullable is not set
  // This covers lines 179-181 in the source (null passes because 'null' is in type list)
  test('null passes when "null" is in type array even without explicit nullable flag', () => {
    const schema: ValidationSchema = {
      type: 'object',
      properties: {
        optional_count: {
          type: ['number', 'null'],
          required: false,
          // nullable NOT set — but 'null' is in the type array
        },
      },
    };
    expect(() =>
      validateSchema({ optional_count: null }, schema, 'custom'),
    ).not.toThrow();
  });

  // 27. Empty objects pass with no required fields
  test('empty object passes when no fields are required', () => {
    const schema: ValidationSchema = {
      type: 'object',
      properties: {
        optional_field: {
          type: 'string',
          required: false,
        },
      },
    };
    expect(() => validateSchema({}, schema, 'custom')).not.toThrow();
  });

  // 28. Boolean field validation
  test('boolean field validates correctly', () => {
    const schema: ValidationSchema = {
      type: 'object',
      properties: {
        flag: {
          type: 'boolean',
          required: true,
        },
      },
    };
    expect(() =>
      validateSchema({ flag: true }, schema, 'custom'),
    ).not.toThrow();

    expect(() =>
      validateSchema({ flag: 'true' }, schema, 'custom'),
    ).toThrow(LlmSchemaError);
  });

  // 29. Array field without itemType accepts any array content
  test('array field without itemType accepts any items', () => {
    const schema: ValidationSchema = {
      type: 'object',
      properties: {
        mixed: {
          type: 'array',
          required: true,
        },
      },
    };
    expect(() =>
      validateSchema({ mixed: [1, 'two', null, true] }, schema, 'custom'),
    ).not.toThrow();
  });

  // 30. Array with boolean itemType
  test('array with boolean itemType validates items', () => {
    const schema: ValidationSchema = {
      type: 'object',
      properties: {
        flags: {
          type: 'array',
          required: true,
          itemType: 'boolean',
        },
      },
    };
    expect(() =>
      validateSchema({ flags: [true, false] }, schema, 'custom'),
    ).not.toThrow();

    expect(() =>
      validateSchema({ flags: [true, 'false'] }, schema, 'custom'),
    ).toThrow(LlmSchemaError);
  });
});
