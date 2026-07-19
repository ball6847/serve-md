---
createdAt: "2026-07-19T15:49:06Z"
implementedAt: "2026-07-19T16:18:00Z"
reviewedAt: null
---

# Plan: Config Schema + Cliffy `serve` CLI

## Overview

Define **merged application config** (dotenv + env + Cliffy flags) and a **`serve` CLI entry** that parses flags, validates config, constructs logger, and exits cleanly on `CONFIG_INVALID`. HTTP listen can be a stub log line (“would listen…”) if plan 05 is not done; prefer wiring a no-op or placeholder `start` callback so composition root shape is final.

## Depends on

- **01** complete (`AppError`, `Logger`, `deno.json`)

## Contract in

- `ConfigInvalidError`, `Logger`, `ConsoleLogger`
- `await-to-js` + `zod` available via imports map

## Contract out

- `AppConfig` type + `loadConfig(flags, env)` (or equivalent) in `src/config/`
- CLI: `deno task serve` / `deno run` entry runs Cliffy `serve`
- Flags: `--port` (default 8787), `--network` (bind `0.0.0.0` vs `127.0.0.1`), `--watch` / `-w`, optional `--root` (default cwd) if cheap
- Env: `PORT`, `LOG_LEVEL`, `SERVE_MD_DOT_WHITELIST` (comma-separated basenames e.g. `.context`)
- Merge rule: **CLI flag overrides env** when both present
- Invalid port / schema → process exits non-zero with clear message (boundary may print; use logger if already built)

## Target Structure

```
src/config/schema.ts
src/config/loadConfig.ts
src/config/loadConfig_test.ts
src/cli/main.ts
.env.example
deno.json                    # add serve task + npm:cliffy if missing
```

## Files to Create

### `src/config/schema.ts`

- Zod object for final config, e.g.:
  - `port: number` int 1–65535, default 8787
  - `host: string` — `127.0.0.1` | `0.0.0.0`
  - `contentRoot: string` absolute path after resolve
  - `watch: boolean` default false
  - `logLevel: "debug"|"info"|"warn"|"error"`
  - `dotWhitelist: string[]` — directory basenames including leading `.` or normalized form (document choice in code comment once)

### `src/config/loadConfig.ts`

- Inputs: raw flags + `Deno.env` (after dotenv load at composition edge)
- Resolve `contentRoot` with `Deno.cwd()` default
- Return `AppConfig` or throw/return `ConfigInvalidError` — prefer return error value to stay `to()`-friendly from CLI:
  - Signature example: `function loadConfig(input: ConfigInput): AppConfig` that throws only at CLI boundary is weaker; better:
  - `function parseConfig(input: ConfigInput): AppConfig` using zod `.safeParse` and map failure → `ConfigInvalidError` **returned** via result style without custom Result type: either throw only in CLI after check, or return `AppConfig | ConfigInvalidError` and use `instanceof`.

**AGENTS note**: services use `to()`; config load at CLI may use zod safeParse without try/catch.

### `src/cli/main.ts`

- Load dotenv once at top (Deno-recommended approach)
- Cliffy `Command` name `serve-md` or binary name `serve` subcommand per AGENTS table (`serve`)
- Options map to `ConfigInput`
- Build `ConsoleLogger` from `logLevel`
- Log lifecycle: contentRoot, host, port, watch
- Placeholder: `logger.info({}, "serve config ok")` and exit 0 **or** export `buildApp` hook empty for plan 05 — **must not** open HTTP yet if that pulls Hono scope; staying CLI-only is OK for this plan.

### `.env.example`

```
PORT=8787
LOG_LEVEL=info
SERVE_MD_DOT_WHITELIST=
```

## Files to Modify

### `deno.json`

- Task `serve`: run `src/cli/main.ts` with needed permissions (`--allow-env`, `--allow-read`, later net)
- Ensure `cliffy`, `zod`, `dotenv` import map entries

## Files to Delete

- None

## Diagrams

### Sequence Diagram

```
User          main.ts         dotenv        loadConfig       Logger
 |               |               |               |              |
 |--deno task serve------------->|               |              |
 |               |--load-------->|               |              |
 |               |--flags+env------------------->|              |
 |               |               |               |--validate--->|
 |               |<--------------|---------------| AppConfig    |
 |               |--info--------------------------------------->|
 |               |--exit 0------>|               |              |
```

## Test Cases

### TC-02-01: Defaults

**Priority:** P0  
**Type:** Functional

#### Objective

Empty flags/env yield port 8787, host 127.0.0.1, watch false.

#### Preconditions

- Clean env overrides in test

#### Test Steps

1. `parseConfig` with empty input (cwd mocked or accepted).
   **Expected:** port 8787, host `127.0.0.1`, watch false, contentRoot absolute.

#### Post-conditions

- N/A

### TC-02-02: Flag overrides env

**Priority:** P0  
**Type:** Functional

#### Objective

CLI wins over env.

#### Preconditions

- Env PORT=3000, flag port 9999

#### Test Steps

1. Parse with both set.
   **Expected:** port 9999.

#### Post-conditions

- N/A

### TC-02-03: `--network` sets host

**Priority:** P0  
**Type:** Functional

#### Objective

Network flag binds all interfaces.

#### Test Steps

1. parse with network true.
   **Expected:** host `0.0.0.0`.

### TC-02-04: Invalid port

**Priority:** P1  
**Type:** Functional

#### Objective

Reject port 0 or 99999.

#### Test Steps

1. parse invalid port.
   **Expected:** `ConfigInvalidError` or equivalent failure.

### TC-02-05: Dot whitelist parse

**Priority:** P1  
**Type:** Functional

#### Objective

`SERVE_MD_DOT_WHITELIST=.context,.notes` → array of two basenames.

#### Test Steps

1. Parse env string.
   **Expected:** normalized list length 2; empty string → `[]`.

## Verification Commands

```bash
deno task check
deno test -A src/config/
deno run -A src/cli/main.ts serve --help
deno run -A src/cli/main.ts serve --port 8787
```

## Expected Outcome

Operators can run CLI with documented flags; config object is the single input to composition in later plans.

## Rollback Plan

Remove `src/config/`, `src/cli/`, `.env.example`; revert `deno.json` serve task.
