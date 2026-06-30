/**
 * Global test setup for server Jest tests.
 *
 * Suppresses structured logger output (console.log / console.error) during
 * test runs to keep test output clean.
 *
 * This file is loaded via jest.config.js `setupFiles`, so it runs before
 * each test suite but before the test framework (describe / it / beforeAll).
 * Only `jest` global is available here.
 */

jest.spyOn(console, "log").mockImplementation(() => {});
jest.spyOn(console, "error").mockImplementation(() => {});
jest.spyOn(console, "warn").mockImplementation(() => {});
