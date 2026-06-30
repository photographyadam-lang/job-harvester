import fs from 'fs';
import { loadCompanyConfig, resolveBoardToken } from './companyConfig';
import { ConfigValidationError } from './types';

// ---------------------------------------------------------------------------
// Mock `fs` — Node.js built-in properties are non-configurable in Node 22+,
// so we must mock the module at the module level rather than spying.
// `jest.mock` is hoisted by Jest's transform, so we inline `jest.fn()`.
// ---------------------------------------------------------------------------

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(),
}));

const mockedReadFileSync = fs.readFileSync as jest.Mock;

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const validCompanyConfig = {
  name: 'Figma',
  departments: ['Engineering', 'Product'],
  location: 'San Francisco',
  keyword: 'Engineer',
  descriptionKeyword: '',
  boardToken: '',
  sectionHeaders: {
    must_have: ['About the role'],
    nice_to_have: ['Nice to have'],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockedReadFileSync.mockClear();
});

describe('loadCompanyConfig', () => {
  test('loads and returns a valid company config', () => {
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(validCompanyConfig));

    const result = loadCompanyConfig('figma');

    expect(result).toEqual(validCompanyConfig);
  });

  test('defaults location and keyword to empty string when missing', () => {
    const { location: _location, keyword: _keyword, ...noLocOrKeyword } = validCompanyConfig;
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify(noLocOrKeyword),
    );

    const result = loadCompanyConfig('figma');

    expect(result.location).toBe('');
    expect(result.keyword).toBe('');
    expect(result.name).toBe('Figma');
    expect(result.departments).toEqual(['Engineering', 'Product']);
  });

  test('throws ConfigValidationError when the file is missing', () => {
    const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockedReadFileSync.mockImplementationOnce(() => {
      throw err;
    });

    expect(() => loadCompanyConfig('nonexistent')).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "name" is missing', () => {
    const { name: _name, ...partial } = validCompanyConfig;
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(partial));

    expect(() => loadCompanyConfig('figma')).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "departments" is missing', () => {
    const { departments: _departments, ...partial } = validCompanyConfig;
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(partial));

    expect(() => loadCompanyConfig('figma')).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "departments" is empty', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ ...validCompanyConfig, departments: [] }),
    );

    expect(() => loadCompanyConfig('figma')).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "sectionHeaders" is missing', () => {
    const { sectionHeaders: _sectionHeaders, ...partial } = validCompanyConfig;
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(partial));

    expect(() => loadCompanyConfig('figma')).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "sectionHeaders.must_have" is missing', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        ...validCompanyConfig,
        sectionHeaders: { nice_to_have: ['Nice to have'] },
      }),
    );

    expect(() => loadCompanyConfig('figma')).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "sectionHeaders.nice_to_have" is missing', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        ...validCompanyConfig,
        sectionHeaders: { must_have: ['About the role'] },
      }),
    );

    expect(() => loadCompanyConfig('figma')).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "name" is not a string', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ ...validCompanyConfig, name: 123 }),
    );

    expect(() => loadCompanyConfig('figma')).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "departments" is not an array', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ ...validCompanyConfig, departments: 'Engineering' }),
    );

    expect(() => loadCompanyConfig('figma')).toThrow(ConfigValidationError);
  });

  test('defaults boardToken to empty string when missing', () => {
    // validCompanyConfig does not include boardToken
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(validCompanyConfig));

    const result = loadCompanyConfig('figma');

    expect(result.boardToken).toBe('');
  });

  test('parses boardToken when present', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ ...validCompanyConfig, boardToken: 'figma-inc' }),
    );

    const result = loadCompanyConfig('figma');

    expect(result.boardToken).toBe('figma-inc');
  });

  test('defaults boardToken to empty string when not a string', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ ...validCompanyConfig, boardToken: 123 }),
    );

    const result = loadCompanyConfig('figma');

    expect(result.boardToken).toBe('');
  });
});

describe('resolveBoardToken', () => {
  test('returns boardToken when it is non-empty', () => {
    const config = { ...validCompanyConfig, boardToken: 'my-board' };

    const result = resolveBoardToken(config, 'fallback-key');

    expect(result).toBe('my-board');
  });

  test('returns fallbackKey when boardToken is empty string', () => {
    const config = { ...validCompanyConfig, boardToken: '' };

    const result = resolveBoardToken(config, 'fallback-key');

    expect(result).toBe('fallback-key');
  });
});
