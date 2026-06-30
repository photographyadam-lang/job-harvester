/** @type {import("jest").Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  passWithNoTests: true,
  setupFiles: ["<rootDir>/src/test-setup.ts"],
};

module.exports = config;
