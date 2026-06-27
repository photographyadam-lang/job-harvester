import fs from 'fs';
import { loadSkillsProfile } from './skillsProfile';
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

const validSkillsProfile = {
  skills: [
    { name: 'TypeScript', strength: 'must_have' },
    { name: 'React', strength: 'must_have' },
  ],
  gapThreshold: 0.5,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockedReadFileSync.mockClear();
});

describe('loadSkillsProfile', () => {
  test('loads and returns a valid skills profile', () => {
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(validSkillsProfile));

    const result = loadSkillsProfile();

    expect(result).toEqual(validSkillsProfile);
  });

  test('throws ConfigValidationError when the file is missing', () => {
    const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockedReadFileSync.mockImplementationOnce(() => {
      throw err;
    });

    expect(() => loadSkillsProfile()).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "skills" is missing', () => {
    const { skills: _skills, ...partial } = validSkillsProfile;
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(partial));

    expect(() => loadSkillsProfile()).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "skills" is empty', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ ...validSkillsProfile, skills: [] }),
    );

    expect(() => loadSkillsProfile()).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "gapThreshold" is missing', () => {
    const { gapThreshold: _gapThreshold, ...partial } = validSkillsProfile;
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(partial));

    expect(() => loadSkillsProfile()).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "gapThreshold" is out of range (<= 0)', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ ...validSkillsProfile, gapThreshold: 0 }),
    );

    expect(() => loadSkillsProfile()).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "gapThreshold" is out of range (>= 1)', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ ...validSkillsProfile, gapThreshold: 1 }),
    );

    expect(() => loadSkillsProfile()).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when "gapThreshold" is not a number', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ ...validSkillsProfile, gapThreshold: '0.5' }),
    );

    expect(() => loadSkillsProfile()).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when a skill has an invalid strength', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        ...validSkillsProfile,
        skills: [{ name: 'TypeScript', strength: 'invalid_strength' }],
      }),
    );

    expect(() => loadSkillsProfile()).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when a skill entry is missing name', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        ...validSkillsProfile,
        skills: [{ strength: 'must_have' }],
      }),
    );

    expect(() => loadSkillsProfile()).toThrow(ConfigValidationError);
  });

  // -- aliases --

  test('loads a profile with valid aliases', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        ...validSkillsProfile,
        skills: [
          { name: 'TypeScript', strength: 'must_have', aliases: ['TS', 'Typescript'] },
          { name: 'React', strength: 'must_have' },
        ],
      }),
    );

    const result = loadSkillsProfile();

    expect(result.skills[0].aliases).toEqual(['TS', 'Typescript']);
    expect(result.skills[1].aliases).toBeUndefined();
  });

  test('loads a profile with empty aliases array (treated as no aliases)', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        ...validSkillsProfile,
        skills: [{ name: 'TypeScript', strength: 'must_have', aliases: [] }],
      }),
    );

    const result = loadSkillsProfile();

    expect(result.skills[0].aliases).toBeUndefined();
  });

  test('throws ConfigValidationError when aliases is not an array', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        ...validSkillsProfile,
        skills: [{ name: 'TypeScript', strength: 'must_have', aliases: 'TS' }],
      }),
    );

    expect(() => loadSkillsProfile()).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError when an alias entry is not a string', () => {
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        ...validSkillsProfile,
        skills: [{ name: 'TypeScript', strength: 'must_have', aliases: ['TS', 123] }],
      }),
    );

    expect(() => loadSkillsProfile()).toThrow(ConfigValidationError);
  });
});
