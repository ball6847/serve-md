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
  3. Markdown rendering (best-effort): GFM-style content, syntax highlighting, images, tables, Mermaid, footnotes, heading anchors, table of contents with **scroll-spy active section** highlighting in the TOC sidebar, **URL hash tracking of the reading position** (refresh restores the section, never jumps to top), and a **scroll-to-top button**.
  4. HTML rendering: app chrome (navigation) remains visible; document body loads in an **iframe** with scripts and relative assets allowed (owner-trusted files).
  5. Default open target: `README.md` → `readme.md` → `README`; otherwise empty “pick a file” state.
  6. Light / dark theme.
  7. **Content width presets** (layout tool): user can tighten/enlarge reading width or fill the content pane; **same width handling for Markdown and HTML**.
  8. Optional live reload via `--watch` / `-w`.
  9. Network bind: localhost by default; `--network` exposes on all interfaces (e.g. Tailscale). Preferred port (default `8787`) with OS-assigned free port fallback when busy.

- **Feature Boundaries** (v1 **includes**):
  - Read-only serving and rendering of Markdown/HTML under the content root.
  - Client UI for explore → select → render.
  - Structured errors and non-fatal render failures (Mermaid).
  - Soft warning when a selected file is larger than 2MB.
  - Client-only content width layout presets (shared for Markdown + HTML).
- **Feature Boundaries** (v1 **excludes**):
  - Authentication / password protection.
  - Editing, write-back, or git operations.
  - Indexing non-content source files (`.ts`, `.go`, images as first-class nav entries, etc.).
  - Multi-root workspaces / multi-project index.
  - Full-text content search (filename fuzzy search only).
  - PDF/export pipeline.
  - Callouts and math rendering.
  - Per-file or per-kind width settings (one global preference only).
  - Free-form / pixel-slider custom width (presets only).
- **User Scenarios**:
  1. From a project root: start the server, open the browser, land on `README.md` if present, switch to Search, type part of a plan name, open and read it.
  2. Browse mode: expand only folders that lead to Markdown/HTML, open an HTML report; navigation chrome stays visible while the report runs in an iframe.
  3. On Tailscale: start with `--network`, open from another machine on the tailnet, re-read planning docs without cloning extra tooling.
  4. With `--watch`: edit an artifact in the editor; open file and file list refresh without a full manual reload cycle.
  5. Reading a wide table or HTML report: use the content-width control to switch from Comfortable → Wide → Full so the document uses more of the content pane; switch back for prose-heavy Markdown.

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
| Port          | Default: `8787`. Optional `--port` / `PORT` for preferred port. **Before** starting the HTTP server, probe the preferred port with a short-lived TCP bind (not HTTP serve). If free, listen on that port. If unavailable (`AddrInUse`), fall back to **port `0`** so the OS assigns any free port. Log preferred vs actual; `--open` uses the actual port from listen callback. No sequential port scan. |
| Watch         | Off by default. `--watch` / `-w` enables filesystem watch on the content root for list refresh + open-file re-render.                                                                                                                                                                                                    |
| Markdown out  | HTML fragment/page section with styles, highlighting, Mermaid, etc.                                                                                                                                                                                                                                                |
| HTML out      | Original document bytes served into iframe `src` (or blob/src URL under same origin), relative assets resolvable under content root with path traversal protection.                                                                                                                                                      |

#### User Interaction

1. User starts CLI from a repository root (or any folder of interest).
2. Browser opens (or user navigates to) `http://127.0.0.1:8787` when the preferred port is free, or to the **actual** host:port logged at startup when the preferred port was busy and an OS-assigned port was used (or host:port when using `--network`).
3. UI shows:
   - Mode toggle: **Search** | **Browse**.
   - Theme toggle: light / dark.
   - **Content width** control (presets): Comfortable | Wide | Full (see **Content width presets** below).
   - Content area for rendered Markdown or HTML iframe.
4. **Default selection**:
   - If `README.md` exists at content root → open it.
   - Else if `readme.md` exists → open it.
   - Else if `README` exists (extensionless file named exactly `README`) → open it **only if** it is treated as a readable text artifact; if product limits nav to md/html/htm only, then **README without extension is out of nav list** unless implementation special-cases default open. **Product decision**: default-open candidates are `README.md`, then `readme.md` only among scanned types; bare `README` is attempted as default-open if present on disk as a file, but need not appear in the filtered file index unless it matches allowed extensions. Prefer simpler rule: **default-open only `README.md` then `readme.md`; if neither, “pick a file”.** Bare `README` from user answer is interpreted as third priority only when the file exists; if it has no allowed extension it may still be opened as plain/markdown best-effort for default only—**final simple rule adopted below**.
5. Search mode: fzf-style fuzzy match against relative paths / basenames; keyboard-friendly list; select opens file.
6. Browse mode: tree or hierarchical list of folders that contain or lead to content files; select opens file.
7. Markdown path: render in content panel with TOC / anchors as available. As the user scrolls the Markdown content, the TOC sidebar **scroll-spy** marks the heading currently in view as active (see **TOC scroll-spy** under Detailed Requirements) and the **URL hash follows the current section** so refresh restores the reading position (see **Anchor tracking & scroll-to-top** under Detailed Requirements).
8. HTML path: keep shell; body in iframe; scripts and relative assets allowed.
9. Content width: user picks a preset from the topbar; **Markdown body and HTML iframe share the same content-host max-width** (no separate controls or values per kind).
10. Errors: in-app panels; process stays up. Mermaid failures are inline error blocks.

**Default-open resolution (authoritative)**:

1. `README.md` at content root
2. `readme.md` at content root
3. `README` at content root (extensionless; open as plain text or light Markdown best-effort)
4. Empty state: “Pick a file”

**TOC panel & scroll-spy (authoritative)** — Markdown documents only:

| Concern | Specification |
| ------- | ------------- |
| Visibility | Right-rail “On this page” TOC when the open Markdown file has at least one heading with an id; hide when empty or when the open file is HTML / empty state. |
| Entries | Built from server-provided `toc` on `GET /api/file/<rel>`: `{ id, text, level }` per heading (already produced by the render pipeline). Client does not re-parse headings for the list. |
| Click | Clicking a TOC entry smooth-scrolls the **content scroll container** to that heading and updates `location.hash` (file path in the address bar preserved). |
| **Scroll-spy (active section)** | While the user scrolls the Markdown content area, **exactly one** TOC entry is marked active at a time: the heading that is the current reading position (typically the last heading whose top has scrolled at or above a fixed offset near the top of the content viewport, or the first visible heading when above the first section). |
| Active styling | Active TOC link is visually distinct (e.g. accent border / stronger weight / background)—must be theme-aware (light and dark). |
| Sync on load | If the URL has a `#heading-id` fragment on open, scroll to that heading and set the matching TOC entry active. |
| Observer lifecycle | Attach scroll / `IntersectionObserver` listeners when TOC is shown; disconnect and clear active state on `hideToc`, file change, or navigation away. No leaked observers across file opens. |
| Narrow viewports | If the TOC rail is hidden (responsive breakpoint), scroll-spy need not run (no visible target). |
| Scope | Client-only enhancement; no new API fields required beyond existing `toc` + heading `id`s in rendered HTML. |
| Non-goals (v1.x) | Auto-scroll the TOC rail to keep the active item visible is **nice-to-have**, not required. Nested expand/collapse of TOC levels is out of scope. HTML iframe documents do not get app TOC/scroll-spy. |

**Anchor tracking & scroll-to-top (authoritative)** — Markdown documents only:

| Concern | Specification |
| ------- | ------------- |
| Purpose | The URL always reflects the section the user is reading, so a refresh (or a shared/bookmarked link) returns to that section instead of jumping back to the top. A scroll-to-top button compensates for content no longer starting at the top on reload. |
| **Hash tracking** | While the user scrolls Markdown content, the URL hash is updated to the `id` of the **current reading section** — the exact same current-section computation as TOC scroll-spy (one source of truth; the active TOC entry and the URL hash always refer to the same heading). |
| Update mechanism | **`history.replaceState` only.** Scrolling must never create history entries; back/forward navigates *files*, not scroll positions. Updates may be throttled/debounced to avoid churn during fast scrolling (final position must settle on the correct hash). |
| Hash clearing | When the scroll position is above the first heading (document top), the hash is **removed** via `replaceState` (URL becomes `/{relative-path}`). Rule: *no hash = top of document*. |
| Refresh / restore | On full page load or refresh of `/{relative-path}#heading-id`, the client renders the file, then scrolls the content scroll container to that heading and marks the matching TOC entry active. **A refresh with a hash must never land at the top.** |
| Restore timing | Scroll-to-hash runs after `GET /api/file/<rel>` completes and the rendered fragment is in the DOM. If anchor positions can shift while async blocks (Mermaid, images) render, perform a single settle re-scroll once rendering stabilizes — no repeated visible jumps. |
| TOC click interplay | Clicking a TOC entry smooth-scrolls and sets `location.hash` (existing behavior); tracking via `replaceState` keeps the hash accurate afterwards. No conflict. |
| Scroll-to-top button | Floating button at the **bottom-right of the content pane**, overlaying content. Hidden when the content scroll container is near the top; appears after the user scrolls past a threshold of **~1 viewport height**. Theme-aware (light/dark) and keyboard-accessible (labeled button). |
| Button behavior | Click **smooth-scrolls the content scroll container to the top and clears the URL hash** (`replaceState`), consistent with *no hash = top*. |
| Scope | **Markdown documents only.** HTML iframe documents get **no** hash tracking and **no** scroll-to-top button (iframe internal scroll/headings are not the shell's concern; HTML is a quick viewer). |
| Lifecycle | Tracking listeners/observers follow the same lifecycle as scroll-spy: attached with Markdown render, disconnected on file change / navigation. No leaked listeners; the scroll-to-top button is hidden in HTML/empty states. |
| Scope (tech) | **Client-only**; no new API fields, no server changes, no config flags. |
| Non-goals | Per-file scroll memory without a hash (no `localStorage` position store); pixel-exact (sub-heading) offset restoration; hash tracking or scroll-to-top for HTML iframes. |

**Content width presets (authoritative)** — Markdown **and** HTML (identical handling):

| Concern | Specification |
| ------- | ------------- |
| Purpose | Let the reader enlarge, keep comfortable, or fill the content pane without free-form pixel tweaking. Useful for wide tables, HTML reports, and long prose. |
| Scope | **One global layout preference** applied to the shared content host that wraps **both** rendered Markdown and the HTML iframe. Switching file kind must **not** change width unless the user changes the preset. |
| Presets (exactly 3) | **Comfortable** · **Wide** · **Full** — discrete steps only (no continuous slider, no custom px input). |
| Comfortable (default) | Reading-friendly column matching today’s layout: `max-width: 880px`, horizontally centered in the content pane. First visit with no stored preference uses Comfortable. |
| Wide | Intermediate step wider than Comfortable: `max-width: 1120px`, still centered. |
| Full | No artificial max-width cap: content host uses the full width of the content pane (between sidebar and TOC rail when present). Horizontal padding of the content pane may remain. |
| Same path for both kinds | Width is applied on the **content host** (or equivalent single wrapper), not separately on `.markdown-body` vs `iframe`. HTML iframe remains `width: 100%` of that host so it tracks the preset. |
| UI control | Topbar control next to theme toggle (segmented control, cycle button, or compact menu). Labels or accessible names must identify the three presets. Active preset is visually indicated. Theme-aware (light/dark). |
| Persistence | `localStorage` key (e.g. `serve-md-content-width`); restore on load before first paint if practical (same anti-FOUC idea as theme). Invalid/missing value → Comfortable. |
| Apply timing | Changing preset updates layout **immediately** without reloading the open file or re-fetching content. Survives file navigation and Search/Browse mode switches. |
| Empty / error state | Preset still applies to the content host when empty state or in-app error is shown (consistent chrome). |
| Narrow viewports | On small screens where the content pane is already ≤ Comfortable width, presets may have little or no visible effect; Full remains valid. No separate mobile-only preset set required. |
| TOC interaction | Width controls the **content column** only; sidebar and TOC rail widths are unchanged. Full uses remaining space after rails. |
| Scope (tech) | **Client-only**; no new API fields, no server config flag. |
| Non-goals | Per-document remembered width; different Markdown vs HTML defaults; zoom/font-size control; vertical density; exporting print width. |

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
| Invalid stored width preset        | Fall back to Comfortable; do not break shell.                                |
| Viewport narrower than preset cap  | Content host is `width: 100%` of pane up to the preset max-width (no overflow forced by the cap). |
| HTML then Markdown (or reverse)    | Same preset remains active; width must not jump when kind changes.           |
| Refresh with `#heading-id`         | File renders, then content scrolls to the heading; TOC entry active; never resets to top. |
| Hash for renamed/removed heading   | Anchor missing: open at top without error; tracking clears/replaces the stale hash on next scroll. |
| Rapid / continuous scrolling       | Hash updates throttled via `replaceState`; no history entries created; hash settles on final section. |
| Scroll-to-top at document top      | Button hidden; clicking is a no-op zone (not reachable).                     |

## Design Decisions

### Technical Approach

- **Architecture Choice**: Align with repository `AGENTS.md`: Deno runtime, Cliffy CLI (`serve`), Hono + Zod (no OpenAPI/Swagger in v1), light static/server UI (no Vite SPA in v1), port/adapter layering with mandatory Handler/Service/Adapter classes, no database, sentinel errors + `await-to-js` `to()`, logger port, Cliffy flags + dotenv + zod merged config.
- **Key Components**:
  - **CLI composition root**: wire content root, bind address, port, watch flag, logger, filesystem adapter, scan service, render service, HTTP handlers, static UI.
  - **Filesystem adapter (port)**: list/read/stat/watch under root with traversal guards.
  - **Index / scan service**: build content-only tree and flat list for search.
  - **Render service**: Markdown → safe HTML pipeline (highlight, tables, mermaid placeholders, footnotes); HTML mode metadata for iframe URL.
  - **HTTP API**: health/ready, file list/tree, file content/raw, rendered markdown endpoint or server-driven page, static assets for UI and content-relative assets.
  - **Web UI**: shell with Search/Browse toggle, theme, **content width presets** (Comfortable / Wide / Full on shared content host for Markdown + HTML), content panel / iframe, TOC sidebar with scroll-spy active section (Markdown only), live-reload client hook when watch enabled.
- **Data Storage**: None durable beyond filesystem of the user’s project.
- **Interface Design** (authoritative URI scheme — path-style for file identity):

  | Method | Path | Purpose |
  | ------ | ---- | ------- |
  | `GET` | `/health` | Liveness |
  | `GET` | `/ready` | Content root readable |
  | `GET` | `/api/meta` | Server metadata (e.g. `{ watch: boolean }`) |
  | `GET` | `/api/files` | Flat list for search (paths, labels, kinds) |
  | `GET` | `/api/tree` | Browse tree (content-only) |
  | `GET` | `/api/default-file` | Default-open path resolution |
  | `GET` | `/api/file/<relative-path>` | JSON: metadata + rendered HTML for markdown / iframe hint for html |
  | `GET` | `/content/<relative-path>` | Raw bytes for iframe and relative assets (traversal-safe) |
  | `GET` | `/api/events` | SSE reload signals when `--watch` |
  | `GET` | `/ui/<asset>` | Reader static assets (CSS/JS) |
  | `GET` | `/` | Reader shell (HTML); default-open or “pick a file” |
  | `GET` | `/<relative-path>` | **Reader shell for that file** (HTML) — browser address bar deep link |

  **Browser URL = file path (locked product decision):**

  - Opening a document must show the content-root-relative path **in the browser path**, not in a query string.
  - **Before (unsupported):** `http://localhost:8787/?file=.context%2Fplans%2F2026-07-20%2FPLAN.md`
  - **After (canonical):** `http://localhost:8787/.context/plans/2026-07-20/PLAN.md`
  - Same rule for any content file: `/README.md`, `/docs/guide.md`, `/reports/out.html`.
  - Optional fragment for in-document anchors remains allowed: `/docs/guide.md#section-id`.
  - **`?file=` is not supported** for identifying the open document (no dual-mode).
  - Full page load / refresh / share of `/{relative-path}` must open the reader shell with that file selected (server returns the **same shell HTML** as `/`, not raw file bytes). Client derives the open path from `location.pathname` (leading `/` stripped; URL-decoded).
  - Selecting a file in Search/Browse updates the address bar via History API to `/{relative-path}` (no full reload required).
  - Default open when visiting `/` only: resolve README chain; after open, address bar should navigate to `/{that-path}` (e.g. `/README.md`) so the URL always reflects the open file when one is selected.
  - Internal Markdown links to other `.md` / `.markdown` files are rewritten to path-style deep links (`/resolved/rel/path.md` + optional `#anchor`), not `?file=`.

  **Reserved path prefixes (never treat as content-file shell routes):**

  - `/api`, `/api/*`
  - `/content`, `/content/*` — raw bytes only
  - `/ui`, `/ui/*` — static reader assets
  - `/health`, `/ready`
  - Exact `/` — shell without a path-selected file (then client default-open)

  If a content-tree path would collide with a reserved prefix (e.g. a folder literally named `api`), reserved routes win; document as a known limitation (local tool).

  **JSON / raw API (same path identity, different prefixes):**

  - Canonical single-file JSON: `GET /api/file/<relative-path>`  
    Examples: `/api/file/README.md`, `/api/file/.context/plans/foo.md`.
  - Canonical raw/content: `GET /content/<relative-path>`  
    Examples: `/content/docs/report.html`, `/content/assets/diagram.png`.
  - **Do not** use `?path=` (or any query param) as the way to identify a file for `/api/file` or `/content`.
  - Path segments are URL-decoded after routing (spaces → `%20`, unicode percent-encoded as usual). Leading-dot segments (e.g. `.context`) are valid path segments when the file is reachable via product scan rules (dot whitelist).
  - Empty path on `/api/file` or `/content` → validation error (`400`).
  - `..` segments, absolute paths, or resolved escapes outside the content root → `PATH_TRAVERSAL` (`400`).
  - Fixed collection routes must not be swallowed by the `/api/file/*` splat.

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
- [ ] When a Markdown file has headings, the TOC sidebar lists them; clicking an entry scrolls to that heading and updates the URL hash.
- [ ] **TOC scroll-spy**: as the user scrolls Markdown content, the TOC entry for the current section is marked active (exactly one active entry; theme-aware styling); on open with `#id`, the matching entry is active after scroll-to-target.
- [ ] Scroll-spy observers/listeners are cleaned up on file change / TOC hide (no leaks across navigations).
- [ ] **Anchor hash tracking**: while scrolling Markdown content, the URL hash updates via `history.replaceState` to the current section heading id (same current-section rule as scroll-spy); scrolling creates **no** history entries.
- [ ] Scrolling above the first heading clears the hash (URL becomes `/{relative-path}`).
- [ ] **Refresh restore**: full page load/refresh of `/{relative-path}#heading-id` renders the file and restores the scroll position at that heading (never jumps to top); the matching TOC entry is active after restore.
- [ ] **Scroll-to-top button**: appears in the content pane (bottom-right) after ~1 viewport of scrolling, hidden near the top; theme-aware and keyboard-accessible.
- [ ] Clicking scroll-to-top smooth-scrolls the content to top and clears the URL hash.
- [ ] Hash tracking and the scroll-to-top button apply to **Markdown only** — HTML iframe documents show neither.
- [ ] Selecting an HTML file keeps navigation chrome visible and shows document content in an iframe; scripts and relative assets work for same-tree files.
- [ ] Light and dark themes are available and persist for the session (persistence across reloads preferred if trivial).
- [ ] **Content width presets**: topbar control exposes exactly three presets — Comfortable (`max-width: 880px`), Wide (`max-width: 1120px`), Full (no max-width cap / fill content pane).
- [ ] Default preset is Comfortable when no valid `localStorage` value exists.
- [ ] Choosing a preset applies **immediately** to the shared content host for **both** Markdown and HTML iframe (identical width handling); switching file kind does not reset or diverge width.
- [ ] Chosen preset persists across reloads via `localStorage` (e.g. `serve-md-content-width`); invalid values fall back to Comfortable.
- [ ] Active preset is indicated in the UI; control is theme-aware and keyboard-accessible (button/control has name/label).
- [ ] Default listen address is `127.0.0.1:8787`; `--network` listens on `0.0.0.0`; port configurable.
- [ ] **Port fallback**: if the preferred port (default `8787`, or `--port` / `PORT`) is free, the server listens on that port; if it is in use, the process does **not** exit solely for that reason — it binds with port `0` (OS-assigned free port), logs preferred vs actual port, and continues. Probe uses TCP listen/close, not a failed HTTP serve retry.
- [ ] `--open` opens the browser to the **actual** bound port (including when OS-assigned).
- [ ] `--watch` / `-w` refreshes file index and re-renders the open file on changes; without the flag, no watch requirement.
- [ ] Files larger than 2MB show a warning banner but still open.
- [ ] Broken Mermaid blocks show inline errors without failing the whole page.
- [ ] Unreadable/missing paths produce in-app or API error responses without crashing the process.
- [ ] Path traversal attempts outside the content root are rejected.
- [ ] Browser address bar for an open file is `http(s)://host:port/<relative-path>` (e.g. `http://localhost:8787/.context/plans/2026-07-20/PLAN.md`), **not** `/?file=…`.
- [ ] Full page load of `/{relative-path}` serves the reader shell and opens that file; reserved prefixes (`/api`, `/content`, `/ui`, `/health`, `/ready`) are unaffected.
- [ ] Selecting a file updates History to `/{relative-path}`; back/forward restores the open file from the path.
- [ ] Markdown internal links to other content markdown files use path-style `/{rel}` (optional `#anchor`), not `?file=`.
- [ ] Single-file JSON API uses `GET /api/file/<relative-path>` (not `?path=`).
- [ ] Raw content uses `GET /content/<relative-path>` with the same relative-path encoding and traversal rules.
- [ ] Empty file path segments on `/api/file` or `/content` return `400`; traversal returns `PATH_TRAVERSAL` (`400`); missing file returns `NOT_FOUND` (`404`).

### Quality Standards

- [ ] Code follows `AGENTS.md` (layers, sentinel errors, no `try/catch` in app code, logger port, zod validation, no OpenAPI/Vite SPA in v1).
- [ ] Service-layer tests cover path safety, scan rules, README default, and error cases; 100% service coverage is a goal once core stabilizes.
- [ ] Handler tests cover happy path + traversal + not found with fake services/adapters.
- [ ] No auth subsystem is introduced in v1.
- [ ] Logging never includes secrets; uses camelCase fields and `errCode` on failures.

### User Acceptance

- [ ] User can open a real AI-planning repo and read Markdown plans without seeing application source in the navigator.
- [ ] User can open an HTML artifact with nav still available.
- [ ] User can switch Comfortable → Wide → Full and see both Markdown and HTML use the same wider (or full) content column without a page reload.
- [ ] User can expose the server on Tailscale via `--network` and open from another device (owner-trusted threat model).
- [ ] README documents install/run: cwd behavior, flags (`--network`, `--watch`/`-w`, `--port`), preferred port `8787`, OS port-`0` fallback when preferred is busy, dotfile policy and whitelist env.

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
- [ ] API endpoints for list/tree/raw content (path-style file identity: `/api/file/<rel>`, `/content/<rel>`).
- [ ] Default README resolution helper.

**Deliverables**: JSON APIs returning only md/html tree; raw content fetch safe.  
**Time**: ~1 day

### Phase 3: Core Development — Render & UI

**Goal**: Beautiful Markdown + HTML iframe shell with navigation modes.

- [ ] Markdown pipeline (highlight, tables, images, mermaid, footnotes, anchors, TOC).
- [ ] UI: Search (fuzzy) | Browse toggle, theme, **content width presets** (Comfortable / Wide / Full; shared host for md+html; localStorage), content panel, TOC sidebar + scroll-spy active section, **anchor hash tracking + refresh restore + scroll-to-top button** (Markdown only), 2MB warning, error panels.
- [ ] HTML iframe integration and relative asset serving (iframe tracks the same content-host width as Markdown).
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
| **TOC** | **Implemented (panel); scroll-spy planned** | Server computes `toc` entries; UI right-rail “On this page” panel lists headings and click-to-scroll. **Scroll-spy** (auto-mark active TOC entry from content scroll position) is specified under **TOC panel & scroll-spy** and is the next TOC enhancement. |
| **File URI shape** | **Path-style everywhere (locked)** | Browser URL for the open document is `/{relative-path}` (e.g. `http://localhost:8787/.context/plans/…/PLAN.md`), **not** `/?file=…`. JSON API is `GET /api/file/<relative-path>`; raw is `GET /content/<relative-path>`. No query-string file identity. Full refresh of a path serves the reader shell (SPA fallback), not raw bytes. Reserved prefixes: `/api`, `/content`, `/ui`, `/health`, `/ready`. |
| **Content width presets** | **3-step client tool; shared for md + html (locked)** | Topbar control cycles/selects **Comfortable** (880px, default) · **Wide** (1120px) · **Full** (fill content pane). Applied on the single content host so Markdown and HTML iframe use the **exact same** max-width handling. Persist via `localStorage`. No per-file settings, no free-form slider, no server API. |
| **Anchor tracking & scroll-to-top** | **Hash follows reading position; refresh restores section; scroll-to-top button — Markdown only (locked)** | While scrolling Markdown, the URL hash updates via `history.replaceState` to the current section (same computation as TOC scroll-spy); hash cleared at document top. Refresh of `/{path}#id` restores the reading position after render — never jumps to top. Floating scroll-to-top button (bottom-right, ~1 viewport threshold) smooth-scrolls to top and clears the hash. Markdown only; client-only; no history spam; no per-file scroll memory. |

### Beyond PRD Features (Implemented)

The following features were implemented during v1 development but were not specified in the original PRD. They are retained as valuable additions:

| Feature | Description |
| ------- | ----------- |
| **Frontmatter display** | YAML frontmatter is parsed and rendered as a styled metadata block at the top of Markdown articles. |
| **Markdown deep-linking** | Internal `.md` links are rewritten to path-style deep links (`/{relative-path}` + optional `#anchor`) so in-app navigation and shareable URLs match the browser path scheme. |
| **Mermaid pan/zoom + fullscreen** | Mermaid diagrams support mouse wheel zoom, click-to-pan, reset view, and fullscreen toggle — beyond the basic client-side rendering originally specified. |
| **`/api/meta` endpoint** | Exposes server metadata (`{ watch: boolean }`) to the UI. |
| **`.markdown` extension** | The scanner includes `.markdown` in addition to `.md`, `.html`, `.htm`. |

### Clarification History Addendum

| Round | Topics resolved |
| ----- | --------------- |
| 4 (v1.1) | **Removed**: humanized labels, callouts, math rendering. **Retained as planned**: TOC. **Documented**: beyond-PRD features that were implemented (frontmatter display, markdown deep-linking, mermaid pan/zoom+fullscreen, `/api/meta`, `.markdown` extension). |
| 5 (v1.1) | **Locked**: browser URL is `/{relative-path}` (not `/?file=`); JSON `GET /api/file/<relative-path>`; raw `GET /content/<relative-path>`; SPA shell fallback for non-reserved paths; reserved prefixes documented. |
| 6 (v1.1) | **TOC scroll-spy specified**: TOC panel status updated (panel implemented; scroll-spy planned). Active section = exactly one TOC entry from content scroll position; client-only; hash on open; observer cleanup; no new API. |
| 7 (v1.1) | **Content width presets**: 3-step topbar tool (Comfortable 880px · Wide 1120px · Full); **identical** max-width handling for Markdown and HTML via shared content host; default Comfortable; persist `localStorage`; client-only. |
| 8 (v1.1) | **Port fallback**: probe preferred port with short-lived TCP bind before HTTP serve; if busy, bind port `0` (OS assigns free port); log actual port; `--open` uses actual port; no sequential scan. |
| 9 (v1.1) | **Anchor tracking & scroll-to-top**: URL hash tracks current reading section via `history.replaceState` (no history entries); hash cleared at document top; refresh of `/{path}#id` restores position after render (never top); scroll-to-top floating button clears hash; **Markdown only** (HTML iframe excluded from both tracking and button). |

---

## Clarification History

| Round | Topics resolved                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Problem = Glow-for-web for AI plan artifacts in git; MVP includes search, browse, live reload (later made flag), themes, TOC/anchors, math, footnotes, callouts, mermaid; **no auth**; content root = **cwd recursive**.                                                                                                                                                                                          |
| 2     | Nav = **toggle Search \| Browse**; default open README if present; labels = **relative path + humanized basename**; browse = **md/html only**; HTML = **shell + iframe**.                                                                                                                                                                                                                                         |
| 3     | HTML scripts **allowed** (owner-trusted); bind **127.0.0.1** default, **`--network`** → all interfaces; port **8787**; exclude **all dot paths** by default, **env whitelist** for specific dot dirs; extensions **md / html / htm**; watch via **`--watch` / `-w`**; default open **README.md → readme.md → README → pick a file**; non-crash errors; **inline** mermaid/math errors; **warn** if file &gt; 2MB. |
| 4     | v1.1: removed humanized labels, callouts, math; TOC planned; documented beyond-PRD features.                                                                                                                                                                                                                                                                                                                      |
| 5     | **Browser + API path-style**: open file URL is `/{rel}` (e.g. `/.context/plans/…/PLAN.md`), not `/?file=`; API `/api/file/<rel>`; raw `/content/<rel>`; no query file identity.                                                                                                                                                                                                                                      |
| 6     | **TOC scroll-spy**: auto-mark active TOC section while scrolling Markdown content; acceptance criteria + observer lifecycle; TOC panel marked implemented, scroll-spy next.                                                                                                                                                                                                                                        |
| 7     | **Content width presets**: Comfortable / Wide / Full; shared for Markdown + HTML; topbar + localStorage; default Comfortable (880px); no per-file or free-form width.                                                                                                                                                                                                                                               |
| 8     | **Port fallback**: preferred port free → use it; busy → port `0` (OS-assigned); probe via TCP listen/close before `Deno.serve`; log preferred vs actual; `--open` uses actual port.                                                                                                                                                                                                                                 |
| 9     | **Anchor tracking & scroll-to-top**: hash follows reading section (`replaceState`, cleared at top); refresh restores section from `#id`; scroll-to-top button (Markdown only); client-only, no new API.                                                                                                                                                                                                        |

---

**Document Version**: 1.1  
**Created**: 2026-07-19  
**Revised**: 2026-07-28  
**Clarification Rounds**: 9  
**Quality Score**: 97/100
