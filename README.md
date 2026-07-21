# serve-md

A local, single-process Markdown/HTML reader. Scans the
current working directory (or a chosen root) for `.md`, `.html`, and `.htm`
files and serves them in a clean browser UI with no source-code noise and no
authentication.

> **Use case**: AI-assisted planning produces lots of Markdown and HTML artifacts
> (plans, reviews, reports) that sit alongside application source. `serve-md`
> gives them a dedicated, focused reader — locally or over Tailscale.

## Requirements

- [Deno](https://deno.com) ≥ 2.0

No Node.js, no npm install step, no build step. Everything is resolved at
runtime via the import map in `deno.json`.

## Install

```bash
deno install -g -n serve-md --allow-read --allow-net --allow-env --allow-run jsr:@ball6847/serve-md
```

Once installed, `serve-md` is on your `PATH` and can be run from any directory:

```bash
serve-md
# or with flags
serve-md --network --watch
```

## Quick start

```bash
# From the project root you want to read
deno task serve
# → http://127.0.0.1:8787
```

By default, the server binds to `127.0.0.1` and serves the current working
directory. It will open `README.md` (or `readme.md`, or extensionless
`README`) automatically if one is present.

## CLI

```
deno task serve --help
```

| Flag            | Description                                                 | Default             |
| --------------- | ----------------------------------------------------------- | ------------------- |
| `--port <n>`    | Port to listen on                                           | `8787` (env `PORT`) |
| `--network`     | Bind on all interfaces (`0.0.0.0`) — required for Tailscale | `127.0.0.1`         |
| `-w`, `--watch` | Watch content root for changes and notify the UI via SSE    | off                 |
| `--root <path>` | Content root directory                                      | cwd                 |
| `--open`        | Open browser automatically on startup                       | off                 |

## Environment variables

| Var                      | Default   | Description                                                                                                                       |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                   | `8787`    | Port to listen on (overridden by `--port`)                                                                                        |
| `LOG_LEVEL`              | `info`    | One of `debug`, `info`, `warn`, `error`                                                                                           |
| `SERVE_MD_DOT_WHITELIST` | _(empty)_ | Comma-separated list of dot-directory basenames to include (e.g. `.context,.notes`). All other dot paths are excluded by default. |

## What gets indexed

- **Included**: `.md`, `.markdown`, `.html`, `.htm` (case-insensitive extension)
- **Excluded by default**:
  - any path segment starting with `.` (e.g. `.git`, `.idea`, `.cache`)
  - `node_modules`, `dist`, `build`, `vendor`, `target`
- **Path safety**: all file IO is constrained to the content root. `..` and
  absolute paths outside the root are rejected. Symlinks are followed only
  if the resolved real path stays inside the root.

To surface content inside e.g. `.context/`, set
`SERVE_MD_DOT_WHITELIST=.context`.

## Tailscale / `--network` trust model

When started with `--network`, `serve-md` listens on `0.0.0.0`. There is **no
authentication** — anyone reachable on the bind address can read the content
under the served root. HTML files are loaded into iframes with
`sandbox="allow-scripts allow-same-origin allow-forms"`, so:

- **Owner-trusted threat model only**: only run this on networks (e.g.
  Tailscale) where you trust the connected machines.
- Files are not modified; reads are read-only.
- Do not point this at a directory containing secrets you would not share
  on the local network.

## Endpoints

| Method | Path                | Purpose                                                |
| ------ | ------------------- | ------------------------------------------------------ |
| `GET`  | `/`                 | Reader UI (HTML)                                       |
| `GET`  | `/<relative-path>`  | Reader UI with file opened (SPA fallback)              |
| `GET`  | `/ui/styles.css`    | Reader CSS                                             |
| `GET`  | `/ui/app.js`        | Reader JS                                              |
| `GET`  | `/health`           | Liveness — always 200                                  |
| `GET`  | `/ready`            | Readiness — 200 if content root readable, else 503     |
| `GET`  | `/api/meta`         | `{ data: { watch: boolean } }`                         |
| `GET`  | `/api/files`        | `{ data: ContentFile[] }`                              |
| `GET`  | `/api/tree`         | `{ data: ContentTreeNode }`                            |
| `GET`  | `/api/default-file` | `{ data: { path: string \| null } }`                   |
| `GET`  | `/api/file/<rel>`   | Metadata + (for md) rendered `html`, `toc`, `warnings` |
| `GET`  | `/content/<rel>`    | Raw bytes for iframes and relative assets              |
| `GET`  | `/api/events`       | SSE stream of `event: reload` when watch is enabled    |

JSON errors use the envelope `{ "error": { "code", "message" } }`.

## HTTP status codes

| Code  | When                                                    |
| ----- | ------------------------------------------------------- |
| `200` | OK                                                      |
| `400` | `PATH_TRAVERSAL` — request tried to escape content root |
| `404` | `NOT_FOUND` — file/route missing                        |
| `500` | `READ_FAILED`, `CONFIG_INVALID`, or unhandled error     |
| `503` | `NOT_READY` — content root not readable                 |

## Watch / live reload

`deno task serve -w` starts a recursive filesystem watcher. On changes
(debounced ~1000ms), the index refreshes and an `event: reload` is broadcast
over `/api/events`. The UI reconnects automatically and re-fetches the file
list and the currently open file.

## Development

```bash
deno task fmt     # format
deno task lint    # lint
deno task test    # run all tests
deno task check   # fmt + lint + test
```

## Out of scope (v1)

- Authentication / password protection
- Editing, write-back, or git operations
- Indexing non-content source files (`.ts`, `.go`, etc.)
- Multi-root workspaces
- Full-text content search (filename fuzzy only)
- PDF / export pipeline
- OpenAPI / Swagger routes
- Vite SPA / frontend build tooling
