---
createdAt: "2026-07-19T15:49:06Z"
implementedAt: null
reviewedAt: null
---

# Plan: Static UI Shell + Search / Browse Navigation

## Overview

Ship a **light static UI** (no Vite): shell layout, **light/dark theme**, mode toggle **Search | Browse**, fzf-style **fuzzy filename search**, and **directory tree** browse. Loads file list/tree from APIs in plan 06. Selecting a file only updates URL hash/query and highlights selection — **full content rendering is plan 09** (placeholder panel text OK).

## Depends on

- **06** (APIs available when server runs)
- **05** (static file serving capability — add in this plan if missing)

## Contract in

- `GET /api/files`, `GET /api/tree`, `GET /api/default-file`
- Hono can serve static files from `src/ui/`

## Contract out

### Static assets

- `src/ui/index.html` — shell
- `src/ui/styles.css` — layout + themes (`data-theme=light|dark`)
- `src/ui/app.js` — no build step; ES module optional

### UX requirements

- Toggle Search | Browse (one active)
- Search: input filters flat list with **fuzzy** match on `relativePath` / basename (subsequence or simple fzf-like scoring); keyboard ↑↓ enter optional but recommended
- Browse: render tree from `/api/tree`; expand/collapse dirs; files show `humanizedLabel` or name
- Theme toggle; persist `localStorage` key e.g. `serve-md-theme`
- Empty states: “No files found”, list loading/error banner without crashing
- `GET /` serves `index.html`
- Static assets `/ui/*` or embedded paths — document

### Not in this plan

- Markdown HTML injection, iframe, mermaid runtime, 2MB banner (plan 09)
- Watch/SSE (plan 10)

## Target Structure

```
src/ui/index.html
src/ui/styles.css
src/ui/app.js
src/ui/fuzzy.js              # pure fuzzy filter, unit-testable if imported from tests via deno
src/handler/staticHandler.ts # or register in app.ts
src/ui/fuzzy_test.ts         # optional Deno test of fuzzy pure fn
```

## Files to Create / Modify

- Serve static in `app.ts`
- Keep JS readable; classes not required in browser JS (AGENTS class rule is for Deno app layers)

## Diagrams

### State Transition (nav mode)

```
  [Search] --toggle--> [Browse]
     ^                    |
     +-------toggle-------+

  [No selection] --click file--> [Selected path in UI state]
```

## Test Cases

### TC-08-01: Fuzzy subsequence match

**Priority:** P0  
**Type:** Functional

#### Objective

Pure fuzzy helper matches path fragments.

#### Test Steps

1. Filter list with query `mpln` against `docs/my-plan.md`
   **Expected:** included with score &gt; non-match.

### TC-08-02: Static index served

**Priority:** P0  
**Type:** Integration

#### Test Steps

1. `GET /`
   **Expected:** 200 HTML containing app root markers.

### TC-08-03: Manual UI smoke (checklist)

**Priority:** P0  
**Type:** UI

#### Preconditions

- Server running on sample repo with several md files

#### Test Steps

1. Open `/`, switch Browse/Search, type query, see filtered list
   **Expected:** only content files; theme toggles; no console hard errors.

#### Post-conditions

- Selection can be noted in UI even if content placeholder

## Verification Commands

```bash
deno test -A src/ui/fuzzy_test.ts   # if present
deno run -A src/cli/main.ts serve
# open http://127.0.0.1:8787
```

## Expected Outcome

Usable navigation chrome for the product; content panel still placeholder.

## Rollback Plan

Remove `src/ui/*` and static routes.
