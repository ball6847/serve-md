---
createdAt: "2026-07-19T15:49:06Z"
implementedAt: null
reviewedAt: null
---

# Plan: Watch / Live Reload, README Docs, Hardening

## Overview

Add optional **`--watch` / `-w`** filesystem watching with **debounced** index refresh and client notification to reload list + re-fetch open file. Write **operator README** (flags, env, Tailscale trust model, dot whitelist). Final hardening: ready checks, log lines, fixture smoke, ensure AGENTS compliance sweep.

## Depends on

- **09** (full UI + APIs)
- **03** (may extend FileStore with `watch` or use Deno.watchFs in adapter)

## Contract in

- `AppConfig.watch`
- Working serve + UI

## Contract out

### Watch

- When `watch=false`: no watcher, no client reconnect requirement
- When `watch=true`:
  - Adapter or service watches `contentRoot` recursive
  - Debounce (e.g. 100–300ms) burst events
  - On change: `contentIndexService.refresh()`
  - Notify clients via **SSE** `GET /api/events` (recommended) or WebSocket — SSE is enough
  - Event payload e.g. `event: reload\ndata: {"reason":"fs"}\n\n`
  - UI: if watch enabled (expose `GET /api/meta` with `{ watch: boolean }` or embed in index boot config), EventSource reconnect; on event re-fetch files/tree and re-open current path

### Docs

- Root `README.md`: install (Deno), `deno task serve`, flags `--port`, `--network`, `-w`, defaults, `SERVE_MD_DOT_WHITELIST`, security note for `--network` (no auth, owner-trusted HTML scripts), examples Tailscale

### Hardening checklist

- [ ] Path traversal tests still green
- [ ] Dot exclusion defaults
- [ ] No OpenAPI/Swagger routes
- [ ] No try/catch in app code
- [ ] Logger port used in handlers
- [ ] Large file warn still works after reload
- [ ] `.env.example` complete

## Target Structure

```
src/ports/fileStore.ts              # optional watch()
src/adapter/denoFileStore.ts        # or src/adapter/denoWatcher.ts
src/service/watchCoordinator.ts     # optional class
src/handler/eventsHandler.ts
src/ui/app.js                       # EventSource
README.md
testdata/sample/                    # small fixture tree for manual/CI smoke
```

## Diagrams

### Sequence Diagram

```
FS change    Watcher    IndexService    SSE clients    UI
    |           |            |              |          |
    |--event--->|            |              |          |
    |           |--debounce->|              |          |
    |           |--refresh-->|              |          |
    |           |--broadcast-------------->|          |
    |           |            |              |--reload->|
    |           |            |              |--GET apis|
```

### State Transition

```
[Watch off] --start with -w--> [Watching]
[Watching] --fs event--> [Debouncing] --timer--> [Refresh] --> [Watching]
[Watching] --error--> [Watching] (log warn; do not exit)
```

## Test Cases

### TC-10-01: Watch flag wiring

**Priority:** P0  
**Type:** Functional

#### Test Steps

1. Config parse `-w` / `--watch`
   **Expected:** watch true; meta/API reflects it.

### TC-10-02: Debounced refresh

**Priority:** P1  
**Type:** Integration

#### Preconditions

- Temp dir + watch enabled in test (fake clock or short debounce)

#### Test Steps

1. Write new md file under root
   **Expected:** after debounce, listFiles includes it (service-level test without browser).

### TC-10-03: SSE emits on refresh

**Priority:** P1  
**Type:** Integration

#### Test Steps

1. Connect SSE; trigger refresh
   **Expected:** client receives reload event (or test EventTarget fake).

### TC-10-04: Watch off no watcher

**Priority:** P1  
**Type:** Functional

#### Test Steps

1. Start without -w
   **Expected:** no watch handles; SSE may 404 or send only heartbeat none — document: SSE endpoint returns 404 when watch disabled **or** connects but never fires — prefer **404** when disabled to avoid idle connections.

### TC-10-05: README documents flags

**Priority:** P0  
**Type:** Documentation

#### Test Steps

1. README contains port 8787, --network, -w, whitelist env, trust model
   **Expected:** all present.

## Verification Commands

```bash
deno task check
deno test -A
deno run -A src/cli/main.ts serve -w --port 8787
# edit a md file; confirm UI updates
```

## Expected Outcome

Shippable v1: documented, watch-optional Glow-for-web server matching PRD.

## Rollback Plan

Disable watch registration; remove SSE + README sections; keep core reader.
