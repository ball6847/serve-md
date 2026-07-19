---
createdAt: "2026-07-19T15:49:06Z"
implementedAt: null
reviewedAt: null
---

# Plan: serve-md Implementation Order (Index)

## Overview

Master index for the Markdown File Explorer (Glow-for-web) product. Plans are ordered; each is sized for **one developer ≤ 4 hours**, self-contained enough to implement without reconstructing prior work from memory. Every plan lists **Depends on**, **Contract in**, and **Contract out**.

**Product PRD**: `docs/prds/markdown-file-explorer-v1.0-prd.md`  
**Conventions**: `AGENTS.md` (Deno, Hono+Zod, classes, `await-to-js`, logger port, no OpenAPI/Vite SPA)

## Execution Order

| Order  | Plan file                           | Goal                                                               | Est. |
| ------ | ----------------------------------- | ------------------------------------------------------------------ | ---- |
| **1**  | `01_SCAFFOLD_ERRORS_LOGGER_PLAN.md` | Deno project, `AppError`, logger port + adapter                    | 2–3h |
| **2**  | `02_CONFIG_CLI_PLAN.md`             | Cliffy + dotenv + zod config; `serve` flags                        | 2–3h |
| **3**  | `03_FILESYSTEM_PORT_PLAN.md`        | FileStore port + Deno adapter (path-safe)                          | 3–4h |
| **4**  | `04_CONTENT_INDEX_PLAN.md`          | Scan, filter, humanize, tree/list, README default                  | 3–4h |
| **5**  | `05_HTTP_CORE_PLAN.md`              | Hono app, health/ready, error map, composition wire                | 3–4h |
| **6**  | `06_FILES_API_PLAN.md`              | JSON list/tree/file + raw content routes                           | 3–4h |
| **7**  | `07_MARKDOWN_RENDER_PLAN.md`        | Markdown → HTML (GFM, highlight, tables, images, mermaid/math/TOC) | 4h   |
| **8**  | `08_UI_SHELL_NAV_PLAN.md`           | Static UI: theme, Search\|Browse, fuzzy + tree                     | 4h   |
| **9**  | `09_CONTENT_VIEW_HTML_PLAN.md`      | Open file view, 2MB warn, MD panel, HTML iframe                    | 3–4h |
| **10** | `10_WATCH_DOCS_HARDENING_PLAN.md`   | `--watch` reload, README docs, hardening                           | 3–4h |

**Rule**: Do not start plan _N_ until plan _N−1_ verification commands pass.

## Target Structure (end state)

```
serve-md/
├── AGENTS.md
├── README.md
├── deno.json
├── .env.example
├── docs/prds/...
├── src/
│   ├── cli/
│   │   └── main.ts                 # composition root
│   ├── config/
│   │   └── schema.ts               # zod merged config
│   ├── domain/
│   │   ├── contentFile.ts
│   │   └── errors.ts               # AppError + sentinels
│   ├── ports/
│   │   ├── fileStore.ts
│   │   └── logger.ts
│   ├── adapter/
│   │   ├── denoFileStore.ts
│   │   └── consoleLogger.ts        # or pino behind same port
│   ├── service/
│   │   ├── contentIndexService.ts
│   │   └── markdownRenderService.ts
│   ├── handler/
│   │   ├── healthHandler.ts
│   │   ├── filesHandler.ts
│   │   └── app.ts                  # Hono app factory
│   ├── api/
│   │   └── schemas/
│   └── ui/                         # static assets
│       ├── index.html
│       ├── app.js
│       └── styles.css
└── ..._test.ts colocated
```

## Dependency Graph

```
01 Scaffold/Errors/Logger
        |
        v
02 Config + CLI
        |
        v
03 Filesystem port
        |
        v
04 Content index service
        |
        v
05 HTTP core (health/ready/onError)
        |
        v
06 Files API
        |
        +------------------+
        v                  v
07 Markdown render    08 UI shell/nav
        |                  |
        +--------+---------+
                 v
        09 Content view + HTML iframe
                 |
                 v
        10 Watch + docs + hardening
```

Plans **07** and **08** both depend only on **06**. Prefer **07 then 08** (render before UI wiring) so 08 can stub render and 09 integrates fully. If staffing two people after 06, 07 and 08 may run in parallel.

## Global Non-Goals (all plans)

- Auth, write/edit, full-text search, database, OpenAPI/Swagger, Vite SPA

## Diagrams

### Sequence Diagram (end-to-end happy path)

```
User    CLI     Hono    FilesHandler   IndexService   FileStore   RenderService
 |       |        |          |              |            |             |
 |--serve-->      |          |              |            |             |
 |       |--listen-->        |              |            |             |
 |--GET /-->      |          |              |            |             |
 |       |        |--UI----->|              |            |             |
 |--GET /api/files-->        |              |            |             |
 |       |        |--------->|--list------->|--scan----->|             |
 |       |        |<---------|<-------------|<-entries---|             |
 |--GET /api/files/content?path=...------->|             |             |
 |       |        |--------->|--read------->|--read----->|             |
 |       |        |          |--render---------------------->|         |
 |       |        |<---------|<------------------------------|         |
```

## Test Cases

### TC-IDX-01: Plan order gate

**Priority:** P0  
**Type:** Process

#### Objective

Ensure implementers do not skip dependencies.

#### Preconditions

- Working tree available

#### Test Steps

1. Before starting plan N, run plan N−1 verification commands.
   **Expected:** All pass; `implementedAt` on N−1 may be set by builder process.

#### Post-conditions

- No partial stacking of untested layers

## Verification Commands

```bash
# After all plans:
deno task check   # fmt + lint + test (once tasks exist)
deno task serve   # manual smoke from a sample content dir
```

## Expected Outcome

Ten sequenced, self-contained plans covering scaffold → shippable Glow-for-web reader.

## Rollback Plan

Revert commits per plan; each plan’s files are listed so rollback is file-scoped.
