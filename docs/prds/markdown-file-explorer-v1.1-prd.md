# Markdown File Explorer - Product Requirements Document (PRD)

## Requirements Description

### Background

- **Business Problem**: AI-assisted planning produces many Markdown and HTML artifacts checked into git repositories. Those files sit beside application source code, which makes it hard to rediscover and re-read them without IDE noise or terminal-only tools.
- **Target Users**: Developers and planners who own local (or Tailscale-reachable) project trees and want a Glow-like reading experience in the browser.
- **Value Proposition**: A simple web server that scans the current working directory for Markdown/HTML only, lets the user search or browse those files, and renders them beautifully—without source-code distraction and without authentication complexity.

### Feature Overview

- **Core Features**:
  1. Recursive scan of content root (default: process CWD) for content files only (`.md`, `.html`, `.htm`).
  2. Two navigation modes (toggle): **Search** (fzf-style filename fuzzy search) and **Browse** (directory tree/list of content-only paths).
  3. Markdown rendering (best-effort): GFM-style content, syntax highlighting, images, tables, Mermaid, footnotes, heading anchors, table of contents.
  4. HTML rendering: app chrome (navigation) remains visible; document body loads in an **iframe** with scripts and relative assets allowed (owner-trusted files).
  5. Default open target: `README.md` → `readme.md` → `README`; otherwise empty “pick a file” state.
  6. Light / dark theme.
  7. Optional live reload via `--watch` / `-w`.
  8. Network bind: localhost by default; `--network` exposes on all interfaces (e.g. Tailscale).
- **Feature Boundaries** (v1 **includes**):
  - Read-only serving and rendering of Markdown/HTML under the content root.
  - Client UI for explore → select → render.
  - Structured errors and non-fatal render failures (Mermaid).
  - Soft warning when a selected file is larger than 2MB.
- **Feature Boundaries** (v1 **excludes**):
  - Authentication / password protection.
  - Editing, write-back, or git operations.
  - Indexing non-content source files (`.ts`, `.go`, images as first-class nav entries, etc.).
  - Multi-root workspaces / multi-project index.
  - Full-text content search (filename fuzzy search only).
  - PDF/export pipeline.
  - Callouts and math rendering.
- **User Scenarios**:
  1. From a project root: start the server, open the browser, land on `README.md` if present, switch to Search, type part of a plan name, open and read it.
  2. Browse mode: expand only folders that lead to Markdown/HTML, open an HTML report; navigation chrome stays visible while the report runs in an iframe.
  3. On Tailscale: start with `--network`, open from another machine on the tailnet, re-read planning docs without cloning extra tooling.
  4. With `--watch`: edit an artifact in the editor; open file and file list refresh without a full manual reload cycle.

### Detailed Requirements

#### Input / Output

| Concern       | Specification                                                                                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Content root  | Default: process **cwd**. Optional override may be introduced as CLI flag (e.g. `--root`) if needed during implementation; cwd is the product default.                                                                                                                                                                   |
| Scan          | Recursive. Include only files ending in `.md`, `.html`, `.htm` (case-sensitive extensions as stored on disk; matching should be case-insensitive on extension where practical).                                                                                                                                          |
| Dot paths     | **Exclude all dotfiles and dot-directories by default** (any path segment starting with `.`).                                                                                                                                                                                                                            |
| Dot whitelist | Optional environment variable enables **whitelist-based** inclusion of specific dot-directory name patterns (e.g. allow `.context` if listed). Exact env name to be defined in implementation (`SERVE_MD_DOT_WHITELIST` or similar); comma-separated or multi-value list of directory basenames.                         |
| Hard excludes | Always exclude well-known noise even if not dot-prefixed if present as common build trees is optional; **minimum bar**: all `.` segments excluded unless whitelisted. Recommended always-exclude of non-dot trees: `node_modules`, `dist`, `build`, `vendor`, `target` (implementation may use a small fixed deny list). |
| HTTP bind     | Default: `127.0.0.1`. With `--network`: `0.0.0.0` (all interfaces).                                                                                                                                                                                                                                                      |
| Port          | Default: `8787`. Optional `--port` for override.                                                                                                                                                                                                                                                                         |
| Watch         | Off by default. `--watch` / `-w` enables filesystem watch on the content root for list refresh + open-file re-render.                                                                                                                                                                                                    |
| Markdown out  | HTML fragment/page section with styles, highlighting, Mermaid, etc.                                                                                                                                                                                                                                                |
| HTML out      | Original document bytes served into iframe `src` (or blob/src URL under same origin), relative assets resolvable under content root with path traversal protection.                                                                                                                                                      |

#### User Interaction

1. User starts CLI from a repository root (or any folder of interest).
2. Browser opens (or user navigates to) `http://127.0.0.1:8787` (or host:port when using `--network`).
3. UI shows:
   - Mode toggle: **Search** | **Browse**.
   - Theme toggle: light / dark.
   - Content area for rendered Markdown or HTML iframe.
4. **Default selection**:
   - If `README.md` exists at content root → open it.
   - Else if `readme.md` exists → open it.
   - Else if `README` exists (extensionless file named exactly `README`) → open it **only if** it is treated as a readable text artifact; if product limits nav to md/html/htm only, then **README without extension is out of nav list** unless implementation special-cases default open. **Product decision**: default-open candidates are `README.md`, then `readme.md` only among scanned types; bare `README` is attempted as default-open if present on disk as a file, but need not appear in the filtered file index unless it matches allowed extensions. Prefer simpler rule: **default-open only `README.md` then `readme.md`; if neither, “pick a file”.** Bare `README` from user answer is interpreted as third priority only when the file exists; if it has no allowed extension it may still be opened as plain/markdown best-effort for default only—**final simple rule adopted below**.
5. Search mode: fzf-style fuzzy match against relative paths / basenames; keyboard-friendly list; select opens file.
6. Browse mode: tree or hierarchical list of folders that contain or lead to content files; select opens file.
7. Markdown path: render in content panel with TOC / anchors as available.
8. HTML path: keep shell; body in iframe; scripts and relative assets allowed.
9. Errors: in-app panels; process stays up. Mermaid failures are inline error blocks.

**Default-open resolution (authoritative)**:

1. `README.md` at content root
2. `readme.md` at content root
3. `README` at content root (extensionless; open as plain text or light Markdown best-effort)
4. Empty state: “Pick a file”

#### Data Requirements

- In-memory file index: relative path, basename, extension/kind (`markdown` | `html`), optional size, optional mtime.
- No database.
- Path safety: reject `..` and absolute escapes outside content root (`PATH_TRAVERSAL` / equivalent).

#### Edge Cases

| Case                               | Behavior                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| No content files                   | Empty browse/search; empty state messaging.                                  |
| No README candidates               | “Pick a file” empty content area.                                            |
| Missing file after index (deleted) | In-app error; refresh index if watch on or on next navigation.               |
| Unreadable file (permissions)      | In-app error with stable error code/message.                                 |
| Path traversal request             | 4xx + sentinel error; never serve outside root.                              |
| File &gt; 2MB                      | Serve/render still attempted; **warn** banner in UI (do not hard-fail).      |
| Broken Mermaid              | Inline error for that block; rest of document renders.                       |
| Malformed Markdown                 | Best-effort render; do not crash.                                            |
| HTML with absolute external assets | Browser loads them as normal (owner-trusted); no proxy requirement in v1.    |
| Symlinks                           | Follow only if resolved path stays inside content root; otherwise skip/deny. |
| Watch storms                       | Debounce reload events.                                                      |

## Design Decisions

### Technical Approach

- **Architecture Choice**: Align with repository `AGENTS.md`: Deno runtime, Cliffy CLI (`serve`), Hono + Zod (no OpenAPI/Swagger in v1), light static/server UI (no Vite SPA in v1), port/adapter layering with mandatory Handler/Service/Adapter classes, no database, sentinel errors + `await-to-js` `to()`, logger port, Cliffy flags + dotenv + zod merged config.
- **Key Components**:
  - **CLI composition root**: wire content root, bind address, port, watch flag, logger, filesystem adapter, scan service, render service, HTTP handlers, static UI.
  - **Filesystem adapter (port)**: list/read/stat/watch under root with traversal guards.
  - **Index / scan service**: build content-only tree and flat list for search.
  - **Render service**: Markdown → safe HTML pipeline (highlight, tables, mermaid placeholders, footnotes); HTML mode metadata for iframe URL.
  - **HTTP API**: health/ready, file list/tree, file content/raw, rendered markdown endpoint or server-driven page, static assets for UI and content-relative assets.
  - **Web UI**: shell with Search/Browse toggle, theme, content panel / iframe, TOC as applicable, live-reload client hook when watch enabled.
- **Data Storage**: None durable beyond filesystem of the user’s project.
- **Interface Design** (illustrative; exact paths may be refined in design/impl):
  - `GET /health` — liveness
  - `GET /ready` — content root readable
  - `GET /api/files` — flat list for search (paths, labels, kinds)
  - `GET /api/tree` — browse tree (content-only)
  - `GET /api/files/*` or query `path=` — metadata + rendered HTML for markdown / iframe URL for html
  - `GET /raw/*` or `/content/*` — raw bytes for iframe and relative assets (traversal-safe)
  - `GET /` — SPA or server-rendered shell
  - Optional SSE/WebSocket when `--watch` for reload signals

### Constraints

- **Performance**: Comfortable for typical monorepos (thousands of files scanned; only md/html retained). Initial scan should complete without multi-second freezes for normal projects; watch debounced.
- **Compatibility**: Modern evergreen browsers; Linux primary (user environment). Deno latest stable.
- **Security**: No auth. Default bind localhost. Path traversal denied. HTML scripts allowed **because files are owner-trusted**—document risk when using `--network`. Dotfiles hidden by default; whitelist is explicit opt-in.
- **Scalability**: Single-process local tool; not a multi-tenant docs host.

### Risk Assessment

- **Technical Risks**:
  - Markdown feature surface (mermaid) varies by library—mitigate with "best-effort" acceptance and inline failure UI.
  - HTML iframe + relative URLs may need a stable base path strategy—mitigate with dedicated content-serving routes.
  - Watch on large trees can be noisy—debounce and scope to content root.
- **Dependency Risks**: Highlighting / Mermaid client or server libs; pin versions; degrade gracefully.
- **Schedule Risks**: Over-scoping "beautiful" Markdown—phase core GFM + highlight + tables + images first, then mermaid/TOC.

## Acceptance Criteria

### Functional Acceptance

- [ ] Starting from a project cwd, the server indexes only `.md`, `.html`, `.htm` files under the root (recursive).
- [ ] Dotfiles and dot-directories are excluded by default; whitelisted dot-directory basenames via env are included when configured.
- [ ] Search mode provides fzf-style fuzzy filtering over content file paths/names.
- [ ] Browse mode shows only directories that lead to content files and lists those files.
- [ ] Mode toggle switches between Search and Browse without losing the overall shell.
- [ ] Default open order: `README.md` → `readme.md` → `README` → empty “pick a file”.
- [ ] Selecting a Markdown file renders with best-effort support for syntax highlight, images, tables, Mermaid, footnotes, heading anchors, and TOC.
- [ ] Selecting an HTML file keeps navigation chrome visible and shows document content in an iframe; scripts and relative assets work for same-tree files.
- [ ] Light and dark themes are available and persist for the session (persistence across reloads preferred if trivial).
- [ ] Default listen address is `127.0.0.1:8787`; `--network` listens on `0.0.0.0`; port configurable.
- [ ] `--watch` / `-w` refreshes file index and re-renders the open file on changes; without the flag, no watch requirement.
- [ ] Files larger than 2MB show a warning banner but still open.
- [ ] Broken Mermaid blocks show inline errors without failing the whole page.
- [ ] Unreadable/missing paths produce in-app or API error responses without crashing the process.
- [ ] Path traversal attempts outside the content root are rejected.

### Quality Standards

- [ ] Code follows `AGENTS.md` (layers, sentinel errors, no `try/catch` in app code, logger port, zod validation, no OpenAPI/Vite SPA in v1).
- [ ] Service-layer tests cover path safety, scan rules, README default, and error cases; 100% service coverage is a goal once core stabilizes.
- [ ] Handler tests cover happy path + traversal + not found with fake services/adapters.
- [ ] No auth subsystem is introduced in v1.
- [ ] Logging never includes secrets; uses camelCase fields and `errCode` on failures.

### User Acceptance

- [ ] User can open a real AI-planning repo and read Markdown plans without seeing application source in the navigator.
- [ ] User can open an HTML artifact with nav still available.
- [ ] User can expose the server on Tailscale via `--network` and open from another device (owner-trusted threat model).
- [ ] README documents install/run: cwd behavior, flags (`--network`, `--watch`/`-w`, `--port`), port `8787`, dotfile policy and whitelist env.

## Execution Phases

### Phase 1: Preparation

**Goal**: Scaffold runtime, config, CLI, and empty HTTP shell.

- [ ] Initialize Deno project (`deno.json`, tasks, fmt/lint).
- [ ] Env/config schema: `PORT`, `LOG_LEVEL`, content root resolution, dot whitelist env.
- [ ] Cliffy `serve` command: `--port`, `--network`, `--watch`/`-w`, content root default cwd.
- [ ] Hono app skeleton: `/health`, `/ready`, Zod-validated routes (no OpenAPI/Swagger in v1).
- [ ] Filesystem port + adapter with traversal-safe resolve.

**Deliverables**: Runnable `serve` that starts and passes health checks.  
**Time**: ~0.5–1 day

### Phase 2: Core Development — Index & API

**Goal**: Content-only discovery and file access APIs.

- [ ] Recursive scan with extension filter and exclude rules.
- [ ] Flat list + tree builders.
- [ ] API endpoints for list/tree/raw content.
- [ ] Default README resolution helper.

**Deliverables**: JSON APIs returning only md/html tree; raw content fetch safe.  
**Time**: ~1 day

### Phase 3: Core Development — Render & UI

**Goal**: Beautiful Markdown + HTML iframe shell with navigation modes.

- [ ] Markdown pipeline (highlight, tables, images, mermaid, footnotes, anchors, TOC).
- [ ] UI: Search (fuzzy) | Browse toggle, theme, content panel, 2MB warning, error panels.
- [ ] HTML iframe integration and relative asset serving.
- [ ] Optional watch + client reload when `-w` set.

**Deliverables**: End-to-end explore → render loop matching Glow-for-web intent.  
**Time**: ~1.5–2 days

### Phase 4: Integration, Hardening & Docs

**Goal**: Quality bar and operator docs.

- [ ] Service/handler/adapter tests; edge cases (traversal, empty, large file warn, missing file).
- [ ] Debounced watch; ready checks for content root.
- [ ] README usage; document Tailscale/`--network` trust model.
- [ ] Manual pass on a real AI-artifact-heavy repo.

**Deliverables**: Documented, tested v1 suitable for daily local/Tailscale use.  
**Time**: ~0.5–1 day

---

## Version 1.1 Changes

**Date**: 2026-07-19

This revision updates the v1.0 PRD based on implementation findings and product decisions made during development.

### Decisions

| Topic | Decision | Rationale |
| ----- | -------- | --------- |
| **Humanized labels** | **Removed** | The humanized label feature (`docs/plans/my-plan.md` → `docs/plans › My Plan`) was removed from the implementation. Raw filenames are displayed instead. This simplifies the index service and UI, and users can rename files directly in their editor if they want different display names. |
| **Callouts** | **Removed from scope** | GFM-style callouts (`> [!NOTE]`, etc.) will not be supported in v1. They are not part of the core Markdown reading experience and add complexity to the render pipeline. |
| **Math rendering** | **Removed from scope** | KaTeX / MathJax integration will not be supported in v1. Math rendering adds a significant client-side dependency and is not required for the core AI-planning-artifact use case. |
| **TOC** | **Planned** | Table of contents rendering is retained as a planned feature. The server already computes TOC entries; the UI panel to display them will be added in a future update. |

### Beyond PRD Features (Implemented)

The following features were implemented during v1 development but were not specified in the original PRD. They are retained as valuable additions:

| Feature | Description |
| ------- | ----------- |
| **Frontmatter display** | YAML frontmatter is parsed and rendered as a styled metadata block at the top of Markdown articles. |
| **Markdown deep-linking** | Internal `.md` links are rewritten to `/?file=...` deep links, enabling in-app navigation without full page reloads. |
| **Mermaid pan/zoom + fullscreen** | Mermaid diagrams support mouse wheel zoom, click-to-pan, reset view, and fullscreen toggle — beyond the basic client-side rendering originally specified. |
| **`/api/meta` endpoint** | Exposes server metadata (`{ watch: boolean }`) to the UI. |
| **`.markdown` extension** | The scanner includes `.markdown` in addition to `.md`, `.html`, `.htm`. |

### Clarification History Addendum

| Round | Topics resolved |
| ----- | --------------- |
| 4 (v1.1) | **Removed**: humanized labels, callouts, math rendering. **Retained as planned**: TOC. **Documented**: beyond-PRD features that were implemented (frontmatter display, markdown deep-linking, mermaid pan/zoom+fullscreen, `/api/meta`, `.markdown` extension). |

---

## Clarification History

| Round | Topics resolved                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Problem = Glow-for-web for AI plan artifacts in git; MVP includes search, browse, live reload (later made flag), themes, TOC/anchors, math, footnotes, callouts, mermaid; **no auth**; content root = **cwd recursive**.                                                                                                                                                                                          |
| 2     | Nav = **toggle Search \| Browse**; default open README if present; labels = **relative path + humanized basename**; browse = **md/html only**; HTML = **shell + iframe**.                                                                                                                                                                                                                                         |
| 3     | HTML scripts **allowed** (owner-trusted); bind **127.0.0.1** default, **`--network`** → all interfaces; port **8787**; exclude **all dot paths** by default, **env whitelist** for specific dot dirs; extensions **md / html / htm**; watch via **`--watch` / `-w`**; default open **README.md → readme.md → README → pick a file**; non-crash errors; **inline** mermaid/math errors; **warn** if file &gt; 2MB. |

---

**Document Version**: 1.1  
**Created**: 2026-07-19  
**Revised**: 2026-07-19  
**Clarification Rounds**: 4  
**Quality Score**: 94/100
