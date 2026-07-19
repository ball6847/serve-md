# AGENTS.md

Technical constraints and conventions for AI agents (and humans) working in this repository.
Read this **before** writing any code.

> Scope of this file: **how** we build. Product requirements define **what** and **why**.

---

## 1. Runtime & Package Management

- **Runtime**: Deno (latest stable). Node.js is not a target.
- **Package manifest**: `deno.json` at repo root (tasks, lint, fmt, tsconfig, npm imports).
- **npm packages** are imported via `npm:` specifiers in `deno.json` `imports` map, e.g. `npm:cliffy@^1`, `npm:hono@^4`, `npm:@hono/zod-openapi@^0.18`, `npm:await-to-js@^1`, `npm:pino@^9`, `npm:zod@^3`.
- **Formatting/lint**: `deno fmt` and `deno lint` are canonical. No Prettier/ESLint.
- **TypeScript**: `strict: true`, `noImplicitAny`, `strictNullChecks`, `exactOptionalPropertyTypes`. No `any` without an inline justification comment.
- **No import path aliases** in Deno source. Use **relative imports** for app code. (Exception: if a Vite SPA exists, it may use Vite path aliases, since Vite—not Deno—resolves them at build time.)

---

## 2. Entry Points & Commands (Cliffy)

CLI via Cliffy, wired in a single composition root (e.g. `src/cli/main.ts`):

| Command | Responsibility                                      | Compose service |
| ------- | --------------------------------------------------- | --------------- |
| `serve` | Hono HTTP API (API + Swagger UI) and any static UI. | `serve`         |

Rules:

- One process per command.
- The **composition root** is the _only_ place that constructs adapters and services and injects dependencies. It selects the command and passes the wired services in.
- Cliffy subcommands receive **already-constructed services**; they must not instantiate adapters themselves.
- The **handler layer exists only for the HTTP API**. Non-HTTP entrypoints (if added later) call services directly.

---

## 3. Architecture — Port & Adapter + Layered (No Database)

**There is no database and no repository layer.** Persistence, if any, is filesystem or in-memory behind adapters. Do not introduce SQLite, Postgres, Drizzle, or any ORM without an explicit product decision and an AGENTS.md update.

```
┌──────────────────────────────────────────────────────────┐
│  Entrypoints (cli: serve, …)                              │  composition root / DI wiring
├──────────────────────────────────────────────────────────┤
│  Handler        (HTTP only — Hono + @hono/zod-openapi)     │  request/response, status mapping
├──────────────────────────────────────────────────────────┤
│  Service        (use-case orchestration)                  │  business rules, retries
├──────────────────────────────────────────────────────────┤
│  Adapter        (ports: filesystem, HTTP clients, etc.)   │  external IO behind an interface
└──────────────────────────────────────────────────────────┘
```

Layering rules (enforced by **review only** — see §10):

- **Handler** → may import Service only.
- **Service** → may import Adapter (interface) + domain types. **Must not** import Hono or any I/O SDK/driver.
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
  - `code: string` — stable, SCREAMING_SNAKE_CASE machine code (e.g. `NOT_FOUND`, `CONFIG_INVALID`, `PATH_TRAVERSAL`, `READ_FAILED`).
  - `message: string` — human-readable.
  - optional `cause`, optional `context: Record<string, unknown>` (never secrets).
- Errors are **values**, not thrown across layer boundaries. Services return `[err, data]` tuples from `to()`; on error they build and return the appropriate sentinel.
- Handlers map `AppError.code` → HTTP status via a single registry:
  ```
  NOT_FOUND → 404, CONFLICT → 409, RATE_LIMITED → 429,
  TEMPORARY → 503, PERMANENT → 422, CONFIG_INVALID → 500, default → 500
  ```
- Logging an error uses pino's `logger.error({ errCode, context }, message)` — never `logger.error(err)` with a raw stack in a user-facing path.

---

## 5. Data / State — No Database

- **No ORM, no SQL, no migration tooling.** Do not add Drizzle, Prisma, SQLite, Postgres, or similar.
- Durable state (if needed) is files under a configured root, env, or process memory — always behind a **port + adapter**.
- Services never call `Deno.readTextFile` / `fetch` / etc. directly; they call port methods.
- Path handling must reject traversal outside the configured content root (`PATH_TRAVERSAL` or equivalent sentinel).

---

## 6. API — Hono + Zod + Swagger from Code

- **Framework**: Hono. Use **`@hono/zod-openapi`** so routes **and** zod schemas are the single source of truth for the OpenAPI document.
- **Swagger**: `GET /openapi.json` serves the OpenAPI document; `GET /docs` serves Swagger UI. Both auto-generated from route definitions + zod schemas. No hand-written OpenAPI.
- **Validation**: every request body / query / param validated with zod; every response typed with zod. Schemas live in `api/schemas/` (or equivalent).
- **Response envelope** (consistent for all 2xx):
  ```json
  { "data": <T> }
  ```
  Errors (4xx/5xx):
  ```json
  { "error": { "code": "NOT_FOUND", "message": "..." } }
  ```
- **URL paths**: all lowercase, **kebab-case**, leading slash, no trailing slash. (e.g. `/api/documents/:slug`, `/health`.)
- **Request/response field names**: **camelCase**.
- **Health endpoints** (both required when `serve` is present):
  - `GET /health` → **liveness**: 200 `{ "status": "ok" }` if the process is alive. No dependency checks.
  - `GET /ready` → **readiness**: 200 if required deps (e.g. content root readable) pass; 503 otherwise, with a `{ "checks": { ... } }` body.

---

## 7. Logging — Pino

- **Structured logs only** via pino. No `console.log` in app code (allowed only in CLI scratch).
- **Log fields are camelCase**: `requestId`, `path`, `errCode`.
- **Never log secrets**: tokens, API keys, authorization headers. If a value might be secret, do not log it.
- Log levels: `debug` (default off in prod), `info` (lifecycle), `warn` (retryable), `error` (terminal failures with `errCode`).
- Correlation: include a stable request or resource id in log lines so a run is traceable.

---

## 8. Config — dotenv (Deno way)

- Env loaded via Deno-native dotenv (`std/dotenv` or `npm:dotenv` per the Deno-recommended path). Single `.env` file at repo root for local; container/orchestrator injects env for prod.
- A zod **env schema** validates and types all required variables at startup. Invalid config → `CONFIG_INVALID` sentinel → process refuses to start.
- Typical env (adjust as product needs solidify):
  - `PORT`, `LOG_LEVEL`
  - content / workspace roots as needed (e.g. `CONTENT_ROOT`)
- Never commit real secrets. Document required vars in README and the zod schema.

---

## 9. Testing

- **Framework**: `Deno.test`. Coverage via `deno coverage`.
- **Service layer: 100% line coverage required.** CI fails below 100% for `src/service/**` (or equivalent path).
- Adapter: integration tests with temp dirs / stubbed HTTP / stubbed subprocess. No live network in CI unless explicitly allowed.
- Handler: tests against the Hono app with fake services injected.
- Fakes over mocks: inject fake adapters implementing the port interface. Avoid runtime mocking libraries.
- Naming: `*_test.ts` colocated with the module (Deno convention).

---

## 10. Layer-Boundary Enforcement — Review Only

- There is **no automated lint rule or tool** that forbids cross-layer imports in v1.
- Layer boundaries (§3) are enforced by **code review only**. The reviewer MUST reject:
  - a Service importing Hono or an external SDK/subprocess/filesystem shim,
  - a Handler importing an Adapter directly,
  - an Adapter importing a Service,
  - any use of a concrete adapter where a port interface should be used,
  - introduction of a database/ORM without an explicit decision.
- If import hygiene becomes a recurring problem, a custom `deno lint` plugin may be added later — **not in v1**.

---

## 11. Naming Conventions — Summary

| Concern              | Convention                              | Example                            |
| -------------------- | --------------------------------------- | ---------------------------------- |
| URL paths            | lowercase kebab-case, no trailing slash | `/api/documents/:slug`             |
| API req/resp fields  | camelCase                               | `contentRoot`, `lastModifiedAt`    |
| Error codes          | SCREAMING_SNAKE_CASE                    | `PATH_TRAVERSAL`, `CONFIG_INVALID` |
| Log fields           | camelCase                               | `requestId`, `errCode`             |
| Env vars             | UPPER_SNAKE_CASE                        | `CONTENT_ROOT`, `LOG_LEVEL`        |
| TS files             | camelCase                               | `markdownService.ts`               |
| Deno source imports  | relative (no aliases)                   | `../service/markdownService.ts`    |
| SPA imports (if any) | Vite aliases OK                         | `@/components/...`                 |
| Classes              | PascalCase                              | `MarkdownService`                  |
| Interfaces (ports)   | PascalCase, no `I` prefix               | `MarkdownStore`                    |
| Sentinel errors      | PascalCase, `Error` suffix              | `MarkdownReadFailedError`          |

---

## 12. Stack Snapshot (intentional)

| Layer    | Choice                                     |
| -------- | ------------------------------------------ |
| Runtime  | Deno                                       |
| CLI      | Cliffy                                     |
| HTTP     | Hono + `@hono/zod-openapi` + Zod           |
| Errors   | Sentinel `AppError` + `await-to-js` `to()` |
| Logging  | pino                                       |
| Config   | dotenv + zod env schema                    |
| Tests    | `Deno.test`                                |
| Database | **None**                                   |
| ORM      | **None**                                   |
