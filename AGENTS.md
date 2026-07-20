# AGENTS.md

Technical constraints and conventions for AI agents (and humans) working in this repository.
Read this **before** writing any code.

> Scope of this file: **how** we build. Product requirements define **what** and **why**.

This project is a **local Glow-for-web style Markdown/HTML reader** (single process, filesystem content root, small UI). Prefer simple solutions that match that size. Do not reintroduce multi-tenant API ceremony (OpenAPI/Swagger, Vite SPA, etc.) without an explicit decision and an update here.

---

## 1. Runtime & Package Management

- **Runtime**: Deno (latest stable). Node.js is not a target.
- **Package manifest**: `deno.json` at repo root (tasks, lint, fmt, tsconfig, npm imports).
- **npm packages** are imported via `npm:` specifiers in `deno.json` `imports` map, e.g. `npm:cliffy@^1`, `npm:hono@^4`, `npm:await-to-js@^1`, `npm:zod@^3`. Optional: a concrete logger impl (e.g. `npm:pino@^9`) behind the logger port.
- **Formatting/lint**: `deno fmt` and `deno lint` are canonical. No Prettier/ESLint.
- **TypeScript**: `strict: true`, `noImplicitAny`, `strictNullChecks`, `exactOptionalPropertyTypes`. No `any` without an inline justification comment.
- **No import path aliases** in Deno source. Use **relative imports** for app code.
- **UI (v1)**: no Vite SPA and no separate frontend toolchain. Prefer server-rendered shell and/or a small amount of static HTML/CSS/JS served by Hono. Introduce Vite only with an explicit product decision and an AGENTS.md update.

---

## 2. Entry Points & Commands (Cliffy)

CLI via Cliffy, wired in a single composition root (e.g. `src/cli/main.ts`):

| Command | Responsibility                                 | Compose service |
| ------- | ---------------------------------------------- | --------------- |
| `serve` | Hono HTTP server (JSON API + static/light UI). | `serve`         |

Rules:

- One process per command.
- The **composition root** is the _only_ place that constructs adapters and services and injects dependencies. It selects the command and passes the wired services in.
- Cliffy subcommands receive **already-constructed services**; they must not instantiate adapters themselves.
- The **handler layer exists only for the HTTP API**. Non-HTTP entrypoints (if added later) call services directly.
- Product flags (examples; exact names follow the PRD): `--port`, `--network`, `--watch` / `-w`. Content root defaults to process cwd unless a flag/env override is defined.

---

## 3. Architecture — Port & Adapter + Layered (No Database)

**There is no database and no repository layer.** Persistence, if any, is filesystem or in-memory behind adapters. Do not introduce SQLite, Postgres, Drizzle, or any ORM without an explicit product decision and an AGENTS.md update.

```
┌──────────────────────────────────────────────────────────┐
│  Entrypoints (cli: serve, …)                              │  composition root / DI wiring
├──────────────────────────────────────────────────────────┤
│  Handler        (HTTP only — Hono + Zod validation)        │  request/response, status mapping
├──────────────────────────────────────────────────────────┤
│  Service        (use-case orchestration)                  │  wiring, retries, error mapping
├──────────────────────────────────────────────────────────┤
│  Adapter        (ports: filesystem, logger, etc.)         │  external IO behind an interface
└──────────────────────────────────────────────────────────┘
```

Layering rules (enforced by **review only** — see §10):

- **Handler** → may import Service only.
- **Service** → may import Adapter (interface) + domain types. **Must not** import Hono or any I/O SDK/driver. **Must not** contain pure business logic — that belongs in `domain/`. Services orchestrate: they call adapters, delegate decisions to domain objects, and map results to sentinel errors.
- **Adapter** → implements a port interface; wraps filesystem, subprocess, or external SDK. No business logic.
- **Ports** (interfaces) live in a `ports/` package with **zero runtime dependencies**. Services depend on ports, not on concrete adapters.
- **Domain types** (entities, value objects, enums) live in `domain/` and are imported by any layer but depend on nothing.

### Dependency Injection

- **Classes are mandatory** for Handler, Service, Adapter. No functional services.
- Constructor injection only. Each class declares its dependencies as `readonly` constructor params.
- No global singletons, no service locator, no decorators. The composition root wires everything.
- Adapters are injected as **interfaces** (TypeScript `interface`), so tests can substitute fakes.

---

## 4. Error Handling — Sentinel Errors + await-to-js

### try/catch is BANNED in application code

- Every `Promise`-returning call must be wrapped with the **raw `to()` from `await-to-js`**, returning a `[err, data]` tuple:
  ```ts
  import { to } from "await-to-js";
  const [err, doc] = await to(markdownStore.read(path));
  if (err) return err(new MarkdownReadFailedError({ cause: err }));
  ```
- **No `try { } catch { }`** in handlers, services, adapters, or CLI commands.
- **Do not** wrap `to()` in a custom `Result<T, AppError>` helper. Use the bare tuple. Type-narrow `err` to `AppError` in service/handler code by construction (errors you create are `AppError`; rewrap unknown errors into a sentinel at the boundary).

### The only allowed exception boundaries

- Framework boundary handlers (NOT try/catch in app code):
  - Hono `app.onError(...)` — maps the final sentinel error to an HTTP response + logs it.
  - `addEventListener("unhandledrejection", ...)` / Deno equivalent — last-resort structured log, then exit non-zero.
- These handlers must **log** and **convert to a sentinel error**, never swallow.

### Sentinel errors

- Every error is a sentinel `class` extending a base `AppError`, carrying:
  - `code: string` — stable, SCREAMING_SNAKE_CASE machine code (e.g. `NOT_FOUND`, `CONFIG_INVALID`, `PATH_TRAVERSAL`, `READ_FAILED`, `NOT_READY`).
  - `message: string` — human-readable.
  - optional `cause`, optional `context: Record<string, unknown>` (never secrets).
- Errors are **values**, not thrown across layer boundaries. Services return `[err, data]` tuples from `to()`; on error they build and return the appropriate sentinel.
- Handlers map `AppError.code` → HTTP status via a single registry. Keep the registry **product-sized**; add codes when needed:
  ```
  NOT_FOUND      → 404
  PATH_TRAVERSAL → 400
  READ_FAILED    → 500
  CONFIG_INVALID → 500
  NOT_READY      → 503
  default        → 500
  ```
- Logging an error uses the injected logger: `logger.error({ errCode, context }, message)` — never log raw stacks on a user-facing path.

---

## 5. Data / State — No Database

- **No ORM, no SQL, no migration tooling.** Do not add Drizzle, Prisma, SQLite, Postgres, or similar.
- Durable state (if needed) is files under a configured root, env, or process memory — always behind a **port + adapter**.
- Services never call `Deno.readTextFile` / `fetch` / etc. directly; they call port methods.
- Path handling must reject traversal outside the configured content root (`PATH_TRAVERSAL` or equivalent sentinel).

---

## 6. API — Hono + Zod (no OpenAPI required)

- **Framework**: Hono. Validate request query / params / body with **Zod**. No `@hono/zod-openapi`, no `/openapi.json`, no Swagger UI in v1 unless explicitly reintroduced later.
- **Validation**: every request input that comes from the client is validated with zod; JSON response shapes used by the UI are typed with zod (schemas live in `api/schemas/` or equivalent).
- **Response kinds** (all first-class; pick the right one per route):
  - **JSON API** (2xx): `{ "data": <T> }`
  - **JSON errors** (4xx/5xx): `{ "error": { "code": "NOT_FOUND", "message": "..." } }`
  - **HTML**: document or fragment for the reader UI (no JSON envelope).
  - **Raw content / assets**: bytes for iframe HTML, images, and relative assets (correct `Content-Type`; no JSON envelope).
- **URL paths**: all lowercase, **kebab-case**, leading slash, no trailing slash (e.g. `/api/files`, `/health`).
- **Request/response field names** (JSON): **camelCase**.
- **Health endpoints** (both required when `serve` is present):
  - `GET /health` → **liveness**: 200 `{ "status": "ok" }` if the process is alive. No dependency checks.
  - `GET /ready` → **readiness**: 200 if required deps (e.g. content root readable) pass; 503 otherwise, with a `{ "checks": { ... } }` body.

---

## 7. Logging — Logger Port

- **Structured logs only** via an injected **logger port** (`Logger` or equivalent interface in `ports/`). No `console.log` in app code (allowed only in CLI scratch / composition bootstrap before the logger exists).
- **Implementation is swappable**: a simple JSON/console adapter is fine for v1; pino (or similar) may be used behind the same port. App code must not import a concrete logger package directly.
- **Log fields are camelCase**: `requestId`, `path`, `errCode`.
- **Never log secrets**: tokens, API keys, authorization headers. If a value might be secret, do not log it.
- Log levels: `debug` (default off in prod), `info` (lifecycle), `warn` (retryable), `error` (terminal failures with `errCode`).
- Correlation: include a stable request or resource id in log lines so a run is traceable.

---

## 8. Config — Cliffy + dotenv

- **Cliffy** owns CLI flags and command wiring (`serve`, `--port`, `--network`, `--watch` / `-w`, etc.).
- **dotenv** loads env from a single `.env` at repo root for local defaults (Deno-native or `npm:dotenv` per Deno-recommended path). Container/orchestrator may inject env in non-local runs.
- A zod **config schema** validates the **merged** result of env + flags at startup (composition root). Invalid config → `CONFIG_INVALID` → process refuses to start.
- **Merge policy**: CLI flags override env when both set (explicit operator intent wins).
- Typical config surface (align names with product PRD as implemented):
  - `PORT` / `--port` (default `8787`)
  - `LOG_LEVEL`
  - content root (default: process cwd)
  - bind mode: localhost vs all interfaces (`--network`)
  - watch enabled (`--watch` / `-w`)
  - dot-directory whitelist env (include specific `.dir` basenames; all other dot paths excluded by default)
- Never commit real secrets. Document flags and env vars in README and the zod schema.

---

## 9. Testing

- **Framework**: `Deno.test`. Coverage via `deno coverage`.
- **Service layer**: aim for strong coverage; prioritize path safety, scan/index rules, and render orchestration. **100% line coverage for `src/service/**` is a goal\*\*, not a hard CI fail gate in early v1—tighten to a hard gate once core services stabilize.
- **Must-have tests** (do not skip): path traversal rejection, content-only filtering (md/html/htm), dot-path exclusion + whitelist, default README resolution, large-file warning metadata, not-found/unreadable handling.
- Adapter: integration tests with temp dirs / stubbed subprocess. No live network in CI unless explicitly allowed.
- Handler: tests against the Hono app with fake services injected.
- Fakes over mocks: inject fake adapters implementing the port interface. Avoid runtime mocking libraries.
- Naming: `*_test.ts` colocated with the module (Deno convention).

---

## 10. Layer-Boundary Enforcement — Review Only

- There is **no automated lint rule or tool** that forbids cross-layer imports in v1.
- Layer boundaries (§3) are enforced by **code review only**. The reviewer MUST reject:
  - a Service importing Hono or an external SDK/subprocess/filesystem shim,
  - pure business logic living in a Service instead of `domain/`,
  - a Handler importing an Adapter directly,
  - an Adapter importing a Service,
  - any use of a concrete adapter where a port interface should be used,
  - introduction of a database/ORM without an explicit decision,
  - introduction of OpenAPI/Swagger or a Vite SPA without an explicit decision and AGENTS.md update.
- If import hygiene becomes a recurring problem, a custom `deno lint` plugin may be added later — **not in v1**.

---

## 11. Naming Conventions — Summary

| Concern             | Convention                                           | Example                                                                    |
| ------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| URL paths           | lowercase kebab-case, no trailing slash              | `/api/files`, `/health`                                                    |
| API req/resp fields | camelCase                                            | `contentRoot`, `lastModifiedAt`                                            |
| Error codes         | SCREAMING_SNAKE_CASE                                 | `PATH_TRAVERSAL`, `CONFIG_INVALID`                                         |
| Log fields          | camelCase                                            | `requestId`, `errCode`                                                     |
| Env vars            | UPPER_SNAKE_CASE                                     | `LOG_LEVEL`, `PORT`                                                        |
| TS files            | snake_case (`src/ui` uses camelCase), no type suffix | `markdown.ts`, `ui/markdownService.ts`                                     |
| Filename suffixes   | omit technical layer suffix                          | `markdown.ts` not `markdown_service.ts`; `files.ts` not `files_handler.ts` |
| Deno source imports | relative (no aliases)                                | `../service/markdownService.ts`                                            |
| Classes             | PascalCase                                           | `MarkdownService`                                                          |
| Interfaces (ports)  | PascalCase, no `I` prefix                            | `FileStore`, `Logger`                                                      |
| Sentinel errors     | PascalCase, `Error` suffix                           | `MarkdownReadFailedError`                                                  |

---

## 12. Stack Snapshot (intentional)

| Layer    | Choice                                           |
| -------- | ------------------------------------------------ |
| Runtime  | Deno                                             |
| CLI      | Cliffy                                           |
| HTTP     | Hono + Zod (no OpenAPI/Swagger in v1)            |
| UI       | Static / light server UI (no Vite SPA in v1)     |
| Errors   | Sentinel `AppError` + `await-to-js` `to()`       |
| Logging  | Logger **port** (simple or pino adapter)         |
| Config   | Cliffy flags + dotenv + zod merged config schema |
| Tests    | `Deno.test` (strong service coverage; 100% goal) |
| Database | **None**                                         |
| ORM      | **None**                                         |
