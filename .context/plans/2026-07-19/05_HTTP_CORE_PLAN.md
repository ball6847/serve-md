---
createdAt: "2026-07-19T15:49:06Z"
implementedAt: "2026-07-19T16:45:00Z"
reviewedAt: null
---

# Plan: Hono HTTP Core (Health, Ready, Error Mapping, Composition)

## Overview

Stand up the **Hono application factory**, **status mapping for AppError**, **`/health` and `/ready`**, wire **composition root** in CLI to listen with config host/port, inject `ContentIndexService` + `FileStore` + `Logger`. No files API yet — ready checks content root readability via store/index.

## Depends on

- **02** (config, CLI)
- **03** (FileStore)
- **04** (ContentIndexService — for ready: index refresh or root stat)

## Contract in

- `AppConfig`, CLI entry
- `DenoFileStore`, `ContentIndexService`, `Logger`

## Contract out

- `src/handler/app.ts` — `createApp(deps): Hono` (or class `AppHandler` factory per AGENTS **class mandatory for Handler** — e.g. `class HttpApp { constructor(deps); toHono(): Hono }` or `HealthHandler` + `ReadyHandler` classes registered in `createApp`)
- `src/handler/errorMapper.ts` — code → status + JSON `{ error: { code, message } }`
- `app.onError` logs with logger (`errCode`, message) and returns envelope
- `GET /health` → `{ status: "ok" }` (liveness; PRD/AGENTS — not necessarily `{data:}` for health; keep simple as AGENTS specifies `{ "status": "ok" }`)
- `GET /ready` → 200 + checks if content root usable; 503 + `NotReadyError` body shape if not
- CLI `serve` actually **listens** (`Deno.serve` or `@hono/node-server` — **use Deno.serve with Hono fetch**)

## Target Structure

```
src/handler/app.ts
src/handler/healthHandler.ts
src/handler/readyHandler.ts
src/handler/errorMapper.ts
src/handler/app_test.ts
src/cli/main.ts                 # modify: listen
```

## Files to Create

### Handlers (classes)

- `HealthHandler` — method returning Response or registers route
- `ReadyHandler` — uses store.stat(".") or index.refresh; on failure 503 with `{ checks: { contentRoot: false } }` style per AGENTS

### `errorMapper.ts`

```
NOT_FOUND → 404
PATH_TRAVERSAL → 400
READ_FAILED → 500
CONFIG_INVALID → 500
NOT_READY → 503
default → 500
```

### `app_test.ts`

- Inject fakes; supertest-style `app.request("http://local/health")`

## Files to Modify

### `src/cli/main.ts`

- After config: construct FileStore, ContentIndexService, initial `refresh` (log error if fail but still listen? **prefer**: log warn, ready fails until fixed)
- `createApp` + `Deno.serve({ hostname, port, handler: app.fetch })`
- Permissions: `--allow-net`, `--allow-read`

### `deno.json`

- `serve` task permissions updated

## Files to Delete

- None

## Diagrams

### Sequence Diagram

```
CLI          createApp       ReadyHandler    FileStore
 |               |                |              |
 |--build------->|                |              |
 |--listen------>|                |              |
 |               |<--GET /ready---|              |
 |               |                |--stat------->|
 |               |                |<--ok---------|
 |               |--200 checks----|              |
```

## Test Cases

### TC-05-01: Health always 200

**Priority:** P0  
**Type:** Integration

#### Test Steps

1. `GET /health` with fake deps
   **Expected:** 200, body status ok.

### TC-05-02: Ready 200 when root ok

**Priority:** P0  
**Type:** Integration

#### Test Steps

1. Fake store stat success
   **Expected:** 200, checks contentRoot true.

### TC-05-03: Ready 503 when root fails

**Priority:** P0  
**Type:** Integration

#### Test Steps

1. Fake store fails
   **Expected:** 503; error or checks indicate failure; process not crashed.

### TC-05-04: onError maps PathTraversal

**Priority:** P1  
**Type:** Integration

#### Test Steps

1. Route that throws/returns PathTraversalError through onError
   **Expected:** 400 JSON `{ error: { code: "PATH_TRAVERSAL", message } }`.

## Verification Commands

```bash
deno test -A src/handler/
deno run -A src/cli/main.ts serve --port 8787
# curl -s localhost:8787/health && curl -s localhost:8787/ready
```

## Expected Outcome

Runnable server with ops endpoints; composition root pattern complete for adding routes.

## Rollback Plan

Remove handler modules; revert CLI listen to stub.
