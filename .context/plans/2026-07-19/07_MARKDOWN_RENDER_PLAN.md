---
createdAt: "2026-07-19T15:49:06Z"
implementedAt: "2026-07-19T17:05:00Z"
reviewedAt: null
---

# Plan: Markdown Render Service (Best-Effort Beautiful HTML)

## Overview

Implement **`MarkdownRenderService`** that converts Markdown text to an HTML fragment suitable for the reader panel: GFM (tables, strikethrough, autolink), **syntax highlighting**, images (relative URLs rewritten to `/content/...` where needed), **Mermaid** fences as renderable blocks, **math**, **footnotes**, **callouts/admonitions** best-effort, **heading anchors**, and a **TOC** structure. Broken mermaid/math must not fail the whole document (inline error placeholders). Library choice is implementer-owned but must stay Deno-friendly (npm or esm).

## Depends on

- **01** (errors — optional `ReadFailedError` not needed for pure render)
- **06** optional for route; service is pure-ish: `render(markdown: string, opts: { basePath: string }): RenderResult`

## Contract in

- None from FS if pure function of string; `basePath` is the file’s directory relative path for rewriting relative image links

## Contract out

```ts
export interface TocEntry {
  id: string;
  text: string;
  level: number; // 1-6
}

export interface RenderResult {
  html: string;           // fragment, not full document
  toc: TocEntry[];
  warnings: string[];     // non-fatal issues
}
```

- Class `MarkdownRenderService` with `render(markdown: string, options: { relativeDir: string }): RenderResult`
- Relative image `src` like `./img.png` → `/content/{relativeDir}/img.png` (normalize, block `..`)
- Fenced ` ```mermaid ` → `<div class="mermaid">...</div>` or pre with data attribute for **client** mermaid (preferred: client-side mermaid to isolate failures)
- Math: KaTeX/MathJax client hooks (`$` / `$$` or similar) best-effort; on server failure emit `<span class="math-error">`
- Callouts: GitHub-style `> [!NOTE]` or similar if parser supports; else skip gracefully
- **No throw** on bad markdown; return best-effort HTML

### HTTP (thin)

- Extend `GET /api/file?path=` when kind=markdown to include `html` + `toc` + `warnings` + `largeFile` from plan 06
- Or `GET /api/render?path=` — prefer **enrich existing file endpoint** to avoid extra surface

## Target Structure

```
src/service/markdownRenderService.ts
src/service/markdownRenderService_test.ts
src/handler/filesHandler.ts          # attach render output for md
```

## Files to Create / Modify

As above. Add npm/esm deps to `deno.json` imports (e.g. marked/markdown-it, highlight.js/shiki, etc.) — pin versions.

## Diagrams

### Sequence Diagram

```
FilesHandler    MarkdownRenderService    (libs)
     |                   |                  |
     |--read text------->|                  |
     |--render(md)------>|--parse---------->|
     |                   |--highlight------>|
     |                   |--rewrite imgs--->|
     |<--{html,toc}------|                  |
```

## Test Cases

### TC-07-01: GFM table

**Priority:** P0  
**Type:** Functional

#### Test Steps

1. Render markdown with a pipe table
   **Expected:** `<table>` present in html.

### TC-07-02: Fenced code highlight

**Priority:** P0  
**Type:** Functional

#### Test Steps

1. ` ```ts ` block
   **Expected:** code block with highlight class or token spans; no throw.

### TC-07-03: Relative image rewrite

**Priority:** P0  
**Type:** Functional

#### Test Steps

1. File dir `docs`, md `![](./a.png)`
   **Expected:** src becomes `/content/docs/a.png` (or agreed prefix).

### TC-07-04: Image traversal blocked

**Priority:** P0  
**Type:** Security

#### Test Steps

1. `![](../../etc/passwd)`
   **Expected:** not rewritten to escape; stripped or safe # / empty; no `/content/../`.

### TC-07-05: Mermaid fence preserved for client

**Priority:** P1  
**Type:** Functional

#### Test Steps

1. mermaid fence
   **Expected:** html contains mermaid container with graph source text.

### TC-07-06: Heading anchors + TOC

**Priority:** P1  
**Type:** Functional

#### Test Steps

1. `# Hello World` and `## Sub`
   **Expected:** ids on headings; toc length ≥ 2 with levels.

### TC-07-07: Malformed input soft-fail

**Priority:** P0  
**Type:** Functional

#### Test Steps

1. Weird/unbalanced md
   **Expected:** returns html string; does not throw.

## Verification Commands

```bash
deno test -A src/service/markdownRenderService_test.ts
deno task check
```

## Expected Outcome

Stable HTML fragment API for the UI content panel.

## Rollback Plan

Remove render service + deps from deno.json; strip render fields from file API.
