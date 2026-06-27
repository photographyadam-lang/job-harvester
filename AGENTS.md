# Agent Rules

> Rules for AI coding agents working on this project.
> Read this file at the start of every session before reading SESSIONSTATE.md.

---

## General rules

- Rule 1: Read SESSIONSTATE.md before starting any task
- Rule 2: Do not begin work if ## Active task is blank or [none]
- Rule 3: Only work on the task in ## Active task — do not skip ahead
- Rule 4: Do not modify files listed in ## Out of scope

---

## Project-specific rules

- Rule 5: All work is on branch `main`. Confirm the active branch before every commit
  with `git branch --show-current`.
- Rule 6: Do not commit, push, or call any external service (GitHub, DeepSeek) without
  explicit human instruction in the current conversation.
- Rule 7: Exit criterion for Phase 2 and Phase 3 tasks is `npm test --workspace=server`
  clean. Exit criterion for Phase 1 scaffold tasks is `npm run build --workspace=server`
  clean. Never mark a task done based on manual smoke testing or agent self-report alone.
- Rule 8: No test may make a live HTTP request to the Greenhouse API or a live DeepSeek
  API call. All tests use fixtures in `server/__fixtures__/` or mock the relevant HTTP
  client. A test that reaches the network is a broken test.
- Rule 9: `server/src/types/index.ts` is the single source of truth for all shared
  interfaces. Stage modules, server routes, and client code must import from this file.
  Never redefine or duplicate these types elsewhere.
- Rule 10: Stage modules receive pre-validated config objects as function arguments.
  Stage modules must never call `loadCompanyConfig`, `loadSkillsProfile`, or any
  file-reading function directly.
- Rule 11: No stage module may import from another stage module. `stage2-filter.ts` must
  not import from `stage1-fetch.ts`, etc. Stages communicate only through typed return
  values passed by the orchestrator.
- Rule 12: No business logic in `server/src/server.ts` or any file in
  `server/src/routes/`. Route files call `runPipeline` or config loaders and relay
  results only.
- Rule 13: `DEEPSEEK_API_KEY` lives in `.env` only. It must never appear in config JSON
  files, TypeScript source files, log output, or API responses.
- Rule 14: Test-first is mandatory for all Phase 2 tasks. Write all named test cases
  listed in the task's Done when section, run `npm test` to confirm they fail, then
  implement. Never write implementation before the failing tests are confirmed.
- Rule 15: Windows / PowerShell specifics: use `;` not `&&` as command separator. Use
  `curl.exe` not `curl` (which is aliased to `Invoke-WebRequest`). Use `Select-String`
  not `grep`.
- Rule 16: Before building any stage module, read the input type and output type for
  that stage from `server/src/types/index.ts` and confirm they match the task spec. If
  there is a mismatch, stop and report to the human before writing any code.
- Rule 17: The `he` library is the required dependency for HTML entity decoding in
  `normalizer.ts`. Do not implement a hand-rolled entity decoder.
- Rule 18: `output/processed_ids.json` and `output/{company}-{date}.json` are the only
  files written to the `output/` directory. No other module may write to `output/`.

