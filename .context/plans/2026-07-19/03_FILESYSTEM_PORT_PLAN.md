---
createdAt: "2026-07-19T15:49:06Z"
implementedAt: "2026-07-19T16:25:00Z"
reviewedAt: null
---

# Plan: FileStore Port + Deno Adapter

## Overview

Introduce the **filesystem port** and **Deno adapter** that all content operations go through. Enforce **path traversal protection**, safe resolve under `contentRoot`, read text/bytes, stat, and recursive walk listing. No product filtering of md/html yet (that is plan 04); this plan provides primitive IO + safety.

## Depends on

- **01** (errors, logger, `to()` pattern)
- **02** optional for types only; adapter takes `contentRoot: string` in constructor — **does not require CLI**

## Contract in

- `PathTraversalError`, `ReadFailedError`, `NotFoundError`
- `await-to-js` `to()` in adapter methods

## Contract out

- `src/ports/fileStore.ts` — interface
- `src/adapter/denoFileStore.ts` — class `DenoFileStore`
- Behavior:
  - `resolve(userPath): string` absolute path inside root or error
  - Reject `..`, absolute paths outside root, symlink escape (resolve real path; if outside root → `PATH_TRAVERSAL`)
  - `readText`, `readBytes`, `stat`, `readDir` / `walk` primitives as needed by index service
- Colocated tests with **temp directories** (Deno.makeTempDir)

## Target Structure

```
src/ports/fileStore.ts
src/adapter/denoFileStore.ts
src/adapter/denoFileStore_test.ts
```

## Files to Create

### `src/ports/fileStore.ts`

Interface sketch (names flexible if equivalent):

```ts
export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtime: Date | null;
}

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  /** path relative to content root, posix-style */
  relativePath: string;
}

export interface FileStore {
  readonly contentRoot: string;
  resolveRelative(relativePath: string): Promise<string>; // abs path or throw/return error — prefer return AppError via pattern used in services
  stat(relativePath: string): Promise<FileStat>;
  readText(relativePath: string): Promise<string>;
  readBytes(relativePath: string): Promise<Uint8Array>;
  listDir(relativePath: string): Promise<DirEntry[]>;
  /** recursive file entries only or all nodes — document; index service filters */
  walkFiles(relativePath?: string): Promise<DirEntry[]>;
}
```

**Error style**: Port methods return `Promise<T>` and throw Deno errors **or** return rejected promises; **service** layer wraps with `to()`. Adapter should convert known Deno not-found into rejected `NotFoundError` if that keeps handlers simpler — pick one approach and document in interface comments: **recommended**: adapter rejects with `AppError` subclasses so services rewrap less.

AGENTS: no try/catch — adapter uses `to()` around `Deno.*` calls and returns/rejects with sentinels.

### `src/adapter/denoFileStore.ts`

- Constructor `(contentRoot: string)` — normalize to absolute real path at construct if possible
- All user paths treated as **relative to content root** (strip leading `/`)
- Implementation details left to implementer; must satisfy tests below

### `src/adapter/denoFileStore_test.ts`

- Temp tree with nested files, symlink outside if OS allows, `..` attempts

## Files to Modify

- None required

## Files to Delete

- None

## Diagrams

### Sequence Diagram

```
Service          DenoFileStore           Deno FS
   |                   |                    |
   |--readText("a/../etc/passwd")---------->|
   |                   |--resolve----------->|
   |                   |--outside?---------->|
   |<--PathTraversalError-------------------|
   |                   |                    |
   |--readText("docs/a.md")---------------->|
   |                   |--readTextFile------>|
   |<--string-------------------------------|
```

## Test Cases

### TC-03-01: Read file inside root

**Priority:** P0  
**Type:** Functional

#### Objective

Happy path read.

#### Preconditions

- Temp dir with `hello.md` content `hi`

#### Test Steps

1. `readText("hello.md")`
   **Expected:** `"hi"`; stat size &gt; 0.

### TC-03-02: Reject `..` escape

**Priority:** P0  
**Type:** Security

#### Objective

Traversal denied.

#### Test Steps

1. `readText("../outside.txt")` or nested `a/../../outside`
   **Expected:** `PATH_TRAVERSAL` / `PathTraversalError`; no content leaked.

### TC-03-03: Not found

**Priority:** P0  
**Type:** Functional

#### Objective

Missing file is `NOT_FOUND`.

#### Test Steps

1. `readText("missing.md")`
   **Expected:** `NotFoundError`.

### TC-03-04: walkFiles lists nested

**Priority:** P1  
**Type:** Functional

#### Objective

Recursive listing returns relative paths.

#### Preconditions

- `docs/a.md`, `docs/x/b.md`

#### Test Steps

1. `walkFiles()`
   **Expected:** both paths present with posix relative form.

### TC-03-05: Symlink escape (if supported)

**Priority:** P1  
**Type:** Security

#### Objective

Symlink pointing outside root is not readable as content.

#### Test Steps

1. Create symlink in temp root to `/tmp/...` outside; attempt read/stat.
   **Expected:** `PATH_TRAVERSAL` or skip entry; never return outside bytes.

## Verification Commands

```bash
deno test -A src/adapter/denoFileStore_test.ts
deno task check
```

## Expected Outcome

Safe FS boundary ready for content indexing; no md/html business rules yet.

## Rollback Plan

Delete port + adapter + tests.
