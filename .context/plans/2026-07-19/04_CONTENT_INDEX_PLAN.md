---
createdAt: "2026-07-19T15:49:06Z"
implementedAt: "2026-07-19T16:32:00Z"
reviewedAt: null
---

# Plan: Content Index Service (Scan, Filter, Humanize, Tree, Default Open)

## Overview

Implement **`ContentIndexService`** (class) that turns a `FileStore` into a **content-only** in-memory index: only `.md` / `.html` / `.htm`, exclude dot-segments unless whitelisted, exclude well-known noise dirs, build flat list + browse tree, humanized labels, and **default-open path** resolution (`README.md` → `readme.md` → `README` → none).

## Depends on

- **03** (`FileStore`)
- **01** (errors)
- Config fields conceptually: `dotWhitelist: string[]` — service accepts whitelist in constructor or method args (not dotenv)

## Contract in

- `FileStore.walkFiles` / `stat` / existence checks
- PRD filter rules

## Contract out

### Domain types (`src/domain/contentFile.ts`)

```ts
export type ContentKind = "markdown" | "html" | "plain"; // plain for extensionless README default only

export interface ContentFile {
  relativePath: string;      // posix
  basename: string;
  humanizedLabel: string;    // "docs/plans › My Plan"
  kind: ContentKind;
  size: number;
  mtime: Date | null;
}
```

### Tree node

```ts
export interface ContentTreeNode {
  name: string;              // segment
  relativePath: string;      // dir or file path
  type: "dir" | "file";
  humanizedLabel?: string;   // files only
  kind?: ContentKind;
  children?: ContentTreeNode[];
}
```

### `ContentIndexService` methods

- `refresh(): Promise<void>` — rebuild index from store (use `to()`)
- `listFiles(): ContentFile[]` — flat, stable sort by relativePath
- `getTree(): ContentTreeNode` — root; only dirs that lead to content files
- `getFile(relativePath: string): ContentFile | undefined`
- `resolveDefaultOpen(): string | null` — path relative to root
  1. `README.md` if indexed or exists
  2. `readme.md`
  3. `README` (extensionless; may be `kind: "plain"` and **not** required in listFiles — PRD allows special-case default open; if present on disk, return path even if not in filtered index)
- Humanize: strip extension; `-`/`_` → space; collapse spaces; title-case basename; label = `parentPosix › Humanized` or just humanized basename at root

### Excludes

- Skip any path segment starting with `.` unless segment ∈ whitelist (match basenames like `.context`)
- Always skip directory basenames: `node_modules`, `dist`, `build`, `vendor`, `target` (case-sensitive names as on disk; document)
- Include extensions: `.md`, `.html`, `.htm` (case-insensitive extension match recommended)

## Target Structure

```
src/domain/contentFile.ts
src/service/contentIndexService.ts
src/service/contentIndexService_test.ts
src/service/humanize.ts              # pure helpers OK if tested; still used by service
src/service/humanize_test.ts
```

## Files to Create

### `src/service/humanize.ts`

- Pure functions: `humanizeBasename(filename: string): string`, `formatLabel(relativePath: string): string`

### `src/service/contentIndexService.ts`

- Class with `constructor(private readonly store: FileStore, private readonly options: { dotWhitelist: string[] })`
- No Hono imports
- All async FS via store + `to()`

### Tests with fake `FileStore` (in-memory) — prefer fake over real FS for speed; 1–2 tests with `DenoFileStore` optional

## Files to Modify

- None required

## Files to Delete

- None

## Diagrams

### State Transition (index lifecycle)

```
  [Empty] --refresh() success--> [Ready]
    ^                               |
    |         refresh() fail        |
    +-----------[Error retained / last good optional]
```

Document: on refresh failure, either keep previous index or clear — **prefer keep previous + surface error to caller**.

## Test Cases

### TC-04-01: Only md/html/htm indexed

**Priority:** P0  
**Type:** Functional

#### Preconditions

- Fake store: `a.ts`, `b.md`, `c.HTML`, `d.htm`, `e.txt`

#### Test Steps

1. refresh + listFiles
   **Expected:** only b, c, d (kinds correct).

### TC-04-02: Dot exclusion and whitelist

**Priority:** P0  
**Type:** Functional

#### Preconditions

- `.git/x.md`, `.context/plan.md`, `ok.md`; whitelist `[".context"]`

#### Test Steps

1. refresh
   **Expected:** `ok.md` + `.context/plan.md`; not `.git/x.md`.

### TC-04-03: node_modules skipped

**Priority:** P1  
**Type:** Functional

#### Test Steps

1. `node_modules/pkg/README.md` present
   **Expected:** not listed.

### TC-04-04: Humanized label

**Priority:** P0  
**Type:** Functional

#### Test Steps

1. Path `docs/plans/my-plan.md`
   **Expected:** label `docs/plans › My Plan` (exact separator ` › `).

### TC-04-05: Tree prunes empty dirs

**Priority:** P1  
**Type:** Functional

#### Preconditions

- `src/main.ts` only under src; `docs/a.md`

#### Test Steps

1. getTree
   **Expected:** `docs` present with file; no `src` node.

### TC-04-06: Default open order

**Priority:** P0  
**Type:** Functional

#### Test Steps

1. Only `readme.md` → default that path
2. Both `README.md` and `readme.md` → `README.md`
3. Only extensionless `README` → `README`
4. None → null

### TC-04-07: Path sort stable

**Priority:** P2  
**Type:** Functional

#### Test Steps

1. Multiple files
   **Expected:** listFiles sorted by relativePath ascending.

## Verification Commands

```bash
deno test -A src/service/humanize_test.ts src/service/contentIndexService_test.ts
deno task check
```

## Expected Outcome

Product-facing file inventory API can be thin wrappers over this service.

## Rollback Plan

Remove domain content types + service + tests.
