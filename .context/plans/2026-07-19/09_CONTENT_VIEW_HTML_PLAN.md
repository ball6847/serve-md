---
createdAt: "2026-07-19T15:49:06Z"
implementedAt: null
reviewedAt: null
---

# Plan: Content View — Markdown Panel + HTML iframe

## Overview

Connect selection to **content rendering**: on open Markdown, show rendered HTML + TOC + **&gt;2MB warning** + error panel on failure; on open HTML, keep shell and load document in **iframe** pointing at `/content/...` with scripts allowed; on default load use `/api/default-file`. Wire client-side Mermaid/math init best-effort with **inline errors** for failed blocks. Extensionless `README` as plain/pre or light markdown.

## Depends on

- **07** (render HTML in API)
- **08** (UI shell + selection)
- **06** (raw `/content`)

## Contract in

- `GET /api/file?path=` returns kind, largeFile, html/toc for markdown, etc.
- `GET /content/<path>` for iframe src and assets

## Contract out

### UI behavior

1. On boot: fetch default-file; if path set, open it; else show “Pick a file”
2. On select markdown:
   - Fetch file API
   - If `largeFile`, show warning banner (still render)
   - Inject `html` into content panel (not iframe)
   - Render TOC sidebar/collapsible from `toc`
   - Run mermaid/math enhancers; failures → inline error element, rest stays
3. On select html/htm:
   - Content panel = iframe `src="/content/{path}"` (sandbox: allow scripts — **do not** use restrictive sandbox that blocks scripts; owner-trusted). Prefer **no sandbox attribute** or sandbox with `allow-scripts allow-same-origin` as needed for relative assets
   - Nav chrome remains visible
4. On select plain README: `<pre>` or markdown best-effort
5. API/network errors: in-app error panel; app remains usable
6. Heading anchor clicks work inside markdown panel

### Server

- Ensure `/content` sets `Content-Type: text/html` for html and does not force download
- CSP: do **not** add a CSP that breaks inline mermaid/owner HTML in v1

## Target Structure

```
src/ui/app.js                 # openFile(), renderMd(), renderHtml()
src/ui/styles.css             # content, iframe, warning, toc, error
src/ui/vendor/                # optional vendored mermaid/katex or CDN notes in README — prefer vendor or esm CDN documented
src/handler/filesHandler.ts   # confirm fields
```

## Diagrams

### Sequence Diagram

```
UI                 API                /content
 |--GET default-file->|                  |
 |--GET /api/file---->|                  |
 |  (md: html+toc)    |                  |
 |--inject html-------|                  |
 |--mermaid run-------|                  |
 |                                       |
 |--iframe src=/content/a.html---------->|
 |<--html document-----------------------|
```

## Test Cases

### TC-09-01: Default opens README

**Priority:** P0  
**Type:** UI / Integration

#### Preconditions

- Fixture root with README.md

#### Test Steps

1. Load `/`
   **Expected:** content shows README render (manual or playwright optional; at least API default + unit of openFile logic if extracted).

### TC-09-02: Large file warning

**Priority:** P1  
**Type:** UI

#### Test Steps

1. Open file with largeFile true
   **Expected:** banner visible; content still shown.

### TC-09-03: HTML iframe isolation chrome

**Priority:** P0  
**Type:** UI

#### Test Steps

1. Open `.html` artifact
   **Expected:** sidebar/nav still visible; body in iframe; scripts in fixture run if present.

### TC-09-04: Missing file error panel

**Priority:** P0  
**Type:** UI

#### Test Steps

1. Select path then delete file / request missing
   **Expected:** error panel; no blank crash; can select another file.

### TC-09-05: Mermaid inline failure

**Priority:** P1  
**Type:** UI

#### Test Steps

1. Md with invalid mermaid block + valid paragraph
   **Expected:** paragraph visible; mermaid shows error UI not full-page failure.

## Verification Commands

```bash
deno task check
deno run -A src/cli/main.ts serve
# manual checklist against fixtures under testdata/ if added
```

## Expected Outcome

Core product loop complete: explore → open → read md/html beautifully with chrome.

## Rollback Plan

Revert UI content view changes; keep nav shell.
