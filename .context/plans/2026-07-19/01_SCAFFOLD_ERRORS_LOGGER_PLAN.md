---
createdAt: "2026-07-19T15:49:06Z"
implementedAt: "2026-07-19T16:15:00Z"
reviewedAt: null
---

# Plan: Scaffold, AppError Sentinels, Logger Port

## Overview

Bootstrap the Deno project and the two cross-cutting foundations every later plan imports: **sentinel `AppError` hierarchy** and a **`Logger` port** with a simple console/JSON adapter. No HTTP server and no filesystem product logic yet.

## Depends on

- Nothing (first plan)
- Read: `AGENTS.md`, `docs/prds/markdown-file-explorer-v1.0-prd.md` (context only)

## Contract out (for plan 02+)

- `deno.json` with tasks: at least `fmt`, `lint`, `test`, `check`
- `src/domain/errors.ts`: base `AppError` + codes used later (`NOT_FOUND`, `PATH_TRAVERSAL`, `READ_FAILED`, `CONFIG_INVALID`, `NOT_READY`)
- `src/ports/logger.ts`: `Logger` interface (`debug|info|warn|error` with camelCase bindings + message)
- `src/adapter/consoleLogger.ts`: class implementing `Logger`
- Tests prove error shape and logger does not throw

## Target Structure

```
deno.json
src/domain/errors.ts
src/domain/errors_test.ts
src/ports/logger.ts
src/adapter/consoleLogger.ts
src/adapter/consoleLogger_test.ts
```

## Files to Create

### `deno.json`

- Deno config: `strict` TS options per AGENTS, `imports` map placeholders for `await-to-js`, `zod`, `hono`, `cliffy` (versions pinned; unused imports OK until later plans).
- Tasks: `fmt`, `lint`, `test`, `check` (`fmt --check` + lint + test).

### `src/domain/errors.ts`

- Abstract/base `AppError` extends `Error` with:
  - `readonly code: string`
  - `readonly context?: Record<string, unknown>`
  - optional `cause`
- Concrete sentinels (minimal set; constructors accept message + optional context/cause):
  - `NotFoundError` → `NOT_FOUND`
  - `PathTraversalError` → `PATH_TRAVERSAL`
  - `ReadFailedError` → `READ_FAILED`
  - `ConfigInvalidError` → `CONFIG_INVALID`
  - `NotReadyError` → `NOT_READY`
- Helper optional: `isAppError(err: unknown): err is AppError`

### `src/ports/logger.ts`

```ts
export interface Logger {
  debug(bindings: Record<string, unknown>, message: string): void;
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
  child?(bindings: Record<string, unknown>): Logger;
}
```

### `src/adapter/consoleLogger.ts`

- Class `ConsoleLogger` implements `Logger`
- Constructor: `readonly level` (or min level string)
- Emit single-line JSON or structured fields to stdout/stderr; include level; never throw
- Honor min level (debug suppressed when level=info)

### Tests

- Error instances expose stable `code` and message
- Logger filters debug when configured
- No `try/catch` in production code; tests may use normal Deno.test asserts

## Files to Modify

- None (greenfield)

## Files to Delete

- None

## Diagrams

### ER Diagram (error model)

```
AppError
========
code
message
context?
cause?

NotFoundError --|> AppError
PathTraversalError --|> AppError
ReadFailedError --|> AppError
ConfigInvalidError --|> AppError
NotReadyError --|> AppError
```

## Test Cases

### TC-01-01: AppError codes stable

**Priority:** P0  
**Type:** Functional

#### Objective

Sentinel codes match AGENTS/PRD machine codes.

#### Preconditions

- Module importable

#### Test Steps

1. Construct each sentinel with a message.
   **Expected:** `code` is exact SCREAMING_SNAKE string; `message` preserved; instanceof `AppError` / `Error`.

#### Post-conditions

- N/A

### TC-01-02: Logger level filter

**Priority:** P1  
**Type:** Functional

#### Objective

Debug is silent at info level.

#### Preconditions

- Capture or spy not required if implementation exposes testable side-effect buffer; otherwise instantiate and call without throw.

#### Test Steps

1. Create logger with `info` min level; call `debug` then `info`.
   **Expected:** No throw; info path executes (assert via injectable writer if designed for test).

#### Post-conditions

- N/A

### TC-01-03: deno check tasks exist

**Priority:** P0  
**Type:** Integration

#### Objective

Project tooling runnable.

#### Preconditions

- Deno installed

#### Test Steps

1. Run `deno task check` (or fmt/lint/test individually if check not yet composite).
   **Expected:** Exit 0.

## Verification Commands

```bash
deno fmt --check
deno lint
deno test -A src/domain/errors_test.ts src/adapter/consoleLogger_test.ts
```

## Expected Outcome

Clean Deno project roots; any later plan can `import` errors + logger without redefining them.

## Rollback Plan

Delete `deno.json` and `src/domain`, `src/ports`, `src/adapter` introduced here.
