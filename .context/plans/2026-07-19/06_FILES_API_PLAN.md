---
createdAt: "2026-07-19T15:49:06Z"
implementedAt: null
reviewedAt: null
---

# Plan: Files JSON API + Raw Content Route

## Overview

Expose **read-only HTTP APIs** for the UI and iframe: flat file list, browse tree, file metadata (including size & large-file flag), raw bytes for content/assets, and default-open path. Zod-validate query params. No Markdown HTML pipeline yet (return raw text for md is OK; render is plan 07).

## Depends on

- **05** (Hono app, error mapping)
- **04** (ContentIndexService)

## Contract in

- Index service list/tree/get/default
- FileStore readBytes/readText/stat

## Contract out

### Routes (kebab-case)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/files` | Flat list `{ data: ContentFile[] }` (+ optional `largeFileWarning` helpers client-side) |
| GET | `/api/tree` | Tree `{ data: ContentTreeNode }` |
| GET | `/api/default-file` | `{ data: { path: string \| null } }` |
| GET | `/api/file?path=` | Metadata + for markdown optional `text` raw; include `size`, `largeFile: size > 2MB`, `kind` |
| GET | `/content/*` or `/content?path=` | **Raw** bytes with correct Content-Type; used by HTML iframe + images |

**Path validation**: zod non-empty string; service/store enforce traversal.

**Content-Type map**: `.md` → `text/markdown` or `text/plain`; `.html`/`.htm` → `text/html`; images by extension when serving assets later — for this plan, raw by path under root for any file that passes resolve (needed for HTML relative assets). **Security**: still must stay inside root; do not require md/html-only for `/content` (assets).

### Handler class

- `FilesHandler` with constructor deps: index service, file store, logger
- Register routes on Hono instance in `app.ts`

### Schemas

- `src/api/schemas/files.ts` — zod for responses/query

## Target Structure

```
src/api/schemas/files.ts
src/handler/filesHandler.ts
src/handler/filesHandler_test.ts
src/handler/app.ts                 # register routes
```

## Files to Create / Modify

As above. Tests use temp dir + real DenoFileStore + ContentIndexService **or** fakes.

## Diagrams

### Sequence Diagram

```
UI          FilesHandler     IndexService    FileStore
 |               |                |              |
 |--GET /api/files-------------->|              |
 |               |--list--------->|              |
 |<--{data:[...]}----------------|              |
 |--GET /content/docs/a.html---->|              |
 |               |--readBytes------------------>|
 |<--text/html bytes-------------|              |
```

## Test Cases

### TC-06-01: List returns only content files

**Priority:** P0  
**Type:** Integration

#### Preconditions

- Temp root with md + ts files

#### Test Steps

1. GET `/api/files`
   **Expected:** 200 envelope; only md/html/htm; humanizedLabel present.

### TC-06-02: Tree shape

**Priority:** P1  
**Type:** Integration

#### Test Steps

1. GET `/api/tree`
   **Expected:** nested dirs only where content exists.

### TC-06-03: Default file

**Priority:** P0  
**Type:** Integration

#### Preconditions

- README.md present

#### Test Steps

1. GET `/api/default-file`
   **Expected:** path `README.md`.

### TC-06-04: File metadata large flag

**Priority:** P1  
**Type:** Integration

#### Preconditions

- File size stubbed &gt; 2MB or real large temp file

#### Test Steps

1. GET `/api/file?path=...`
   **Expected:** `largeFile: true`; still 200.

### TC-06-05: Traversal on content

**Priority:** P0  
**Type:** Security

#### Test Steps

1. GET `/content/../../etc/passwd` or `path=../...`
   **Expected:** 400 PATH_TRAVERSAL; no file body.

### TC-06-06: Missing file

**Priority:** P0  
**Type:** Integration

#### Test Steps

1. GET `/api/file?path=nope.md`
   **Expected:** 404 NOT_FOUND JSON error envelope.

## Verification Commands

```bash
deno test -A src/handler/filesHandler_test.ts src/handler/app_test.ts
# manual: serve + curl /api/files /api/tree /api/default-file
```

## Expected Outcome

UI plan can consume stable JSON + raw content URLs without render service.

## Rollback Plan

Remove FilesHandler + schemas; unregister routes.
