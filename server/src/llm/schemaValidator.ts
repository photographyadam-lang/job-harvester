/**
 * Schema validator for LLM JSON output.
 *
 * Validates parsed JSON against expected shapes and throws `LlmSchemaError`
 * with field-level detail on failure.
 *
 * Two pre-built schemas are exported for use by pipeline stages:
 *   - `extractionSchema` — validates ExtractedRequirements + years_experience_required
 *   - `scoreSchema`      — validates score + scoreReasoning
 */

// ---------------------------------------------------------------------------
// LlmSchemaError
// ---------------------------------------------------------------------------

export class LlmSchemaError extends Error {
  /** Human-readable path to the failing field (e.g. "must_haves"). */
  public readonly field: string;

  /** What the validator expected (e.g. "array of strings"). */
  public readonly expected: string;

  /** What was actually received. */
  public readonly actual: string;

  constructor(field: string, expected: string, actual: string) {
    const message = `Field "${field}": expected ${expected}, got ${actual}`;
    super(message);
    this.name = 'LlmSchemaError';
    this.field = field;
    this.expected = expected;
    this.actual = actual;

    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, LlmSchemaError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Schema definition types
// ---------------------------------------------------------------------------

export type JsonPrimitive = 'string' | 'number' | 'boolean' | 'null';
export type JsonType = JsonPrimitive | 'array';

export interface FieldRule {
  /** Expected JSON type(s) for the field. */
  type: JsonType | JsonType[];
  /** Whether the field is required. Default: true. */
  required?: boolean;
  /** Whether null is explicitly allowed. Default: false. */
  nullable?: boolean;
  /** Minimum numeric value (for number fields). */
  min?: number;
  /** Maximum numeric value (for number fields). */
  max?: number;
  /** For array fields: the expected item type. */
  itemType?: JsonPrimitive;
  /** For string fields: require non-empty string. Default: false. */
  notEmpty?: boolean;
}

export interface ValidationSchema {
  type: 'object';
  properties: Record<string, FieldRule>;
}

// ---------------------------------------------------------------------------
// Pre-built schemas
// ---------------------------------------------------------------------------

/**
 * Schema for extraction output (ExtractedRequirements + optional fields).
 *
 * Expected shape:
 * ```json
 * {
 *   "must_haves": ["React", "TypeScript"],
 *   "nice_to_haves": ["GraphQL"],
 *   "years_experience_required": 3
 * }
 * ```
 */
export const extractionSchema: ValidationSchema = {
  type: 'object',
  properties: {
    must_haves: {
      type: 'array',
      required: true,
      itemType: 'string',
    },
    nice_to_haves: {
      type: 'array',
      required: true,
      itemType: 'string',
    },
    years_experience_required: {
      type: ['number', 'null'],
      required: false,
      nullable: true,
    },
  },
};

/**
 * Schema for scoring output.
 *
 * Expected shape:
 * ```json
 * {
 *   "score": 8,
 *   "scoreReasoning": "Strong match across must-have skills"
 * }
 * ```
 */
export const scoreSchema: ValidationSchema = {
  type: 'object',
  properties: {
    score: {
      type: 'number',
      required: true,
      min: 1,
      max: 10,
    },
    scoreReasoning: {
      type: 'string',
      required: true,
      notEmpty: true,
    },
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a parsed JSON value against a schema definition.
 *
 * @param data   - The parsed JSON value to validate.
 * @param schema - The schema to validate against.
 * @param name   - A friendly name for the schema (used in error messages).
 *
 * @throws {LlmSchemaError} When a field fails validation.
 */
export function validateSchema(
  data: unknown,
  schema: ValidationSchema,
  _name: string,
): void {
  if (typeof data !== 'object' || data === null) {
    throw new LlmSchemaError(
      '(root)',
      'object',
      data === null ? 'null' : typeof data,
    );
  }

  const obj = data as Record<string, unknown>;

  // Check each property defined in the schema
  for (const [fieldName, rule] of Object.entries(schema.properties)) {
    const value = obj[fieldName];

    // --- Check required ---
    if (value === undefined) {
      if (rule.required !== false) {
        throw new LlmSchemaError(fieldName, rule.type.toString(), 'undefined');
      }
      continue; // optional field not present — skip further checks
    }

    // --- Check nullable ---
    if (value === null) {
      if (rule.nullable) {
        continue; // null is explicitly allowed
      }
      // Check if 'null' is listed as an allowed type
      const types = Array.isArray(rule.type) ? rule.type : [rule.type];
      if (types.includes('null')) {
        continue;
      }
      throw new LlmSchemaError(fieldName, describeExpectedType(rule), 'null');
    }

    // --- Check type ---
    const actualType = getJsonType(value);
    const allowedTypes = Array.isArray(rule.type) ? rule.type : [rule.type];

    if (!allowedTypes.includes(actualType as JsonType)) {
      throw new LlmSchemaError(
        fieldName,
        describeExpectedType(rule),
        actualType,
      );
    }

    // --- Type-specific validations ---
    if (actualType === 'array' && rule.itemType) {
      const arr = value as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemType = getJsonType(arr[i]);
        if (itemType !== rule.itemType) {
          throw new LlmSchemaError(
            `${fieldName}[${i}]`,
            rule.itemType,
            itemType,
          );
        }
      }
    }

    if (actualType === 'number') {
      const num = value as number;
      if (rule.min !== undefined && num < rule.min) {
        throw new LlmSchemaError(
          fieldName,
          `number >= ${rule.min}`,
          String(num),
        );
      }
      if (rule.max !== undefined && num > rule.max) {
        throw new LlmSchemaError(
          fieldName,
          `number <= ${rule.max}`,
          String(num),
        );
      }
    }

    if (actualType === 'string' && rule.notEmpty) {
      const str = value as string;
      if (str.trim().length === 0) {
        throw new LlmSchemaError(
          fieldName,
          'non-empty string',
          'empty string',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the JSON-level type name of a value.
 */
function getJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Build a human-readable description of the expected type for a field rule.
 */
function describeExpectedType(rule: FieldRule): string {
  const types = Array.isArray(rule.type) ? rule.type : [rule.type];
  let desc = types.join(' or ');

  if (rule.itemType) {
    desc = `array of ${rule.itemType}`;
  }
  if (rule.min !== undefined || rule.max !== undefined) {
    const parts: string[] = [];
    if (rule.min !== undefined) parts.push(`>= ${rule.min}`);
    if (rule.max !== undefined) parts.push(`<= ${rule.max}`);
    desc += ` (${parts.join(', ')})`;
  }
  if (rule.notEmpty) {
    desc += ' (non-empty)';
  }
  return desc;
}
