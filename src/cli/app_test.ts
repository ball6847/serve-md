import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { createApp } from "./main.ts";
import { HealthHandler } from "../handler/health_handler.ts";
import { FilesHandler } from "../handler/files_handler.ts";
import { EventsHandler } from "../handler/events_handler.ts";
import { errorEnvelope, statusFor } from "../handler/error_mapper.ts";
import { FakeFileStore } from "../adapter/fake_file_store.ts";
import { ContentIndexService } from "../service/content_index_service.ts";
import { ConsoleLogger } from "../adapter/console_logger.ts";
import { NotFoundError, PathTraversalError } from "../domain/errors.ts";
import { Hono } from "hono";
import type { Logger } from "../ports/logger.ts";
import { FakeStaticAssetStore } from "../adapter/fake_static_asset_store.ts";

function silentLogger(): Logger {
  return new ConsoleLogger({ level: "error", writer: () => {} });
}

interface Built {
  app: Hono;
  store: FakeFileStore;
  index: ContentIndexService;
}

async function build(opts?: { throwOnReady?: Error }): Promise<Built> {
  const store = new FakeFileStore("/root");
  store.add("a.md", "x");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();

  let storeForHandler: FakeFileStore = store;
  if (opts?.throwOnReady) {
    const failErr: Error = opts.throwOnReady;
    class FailingStatStore extends FakeFileStore {
      override stat(_p: string): Promise<import("../ports/file_store.ts").FileStat> {
        return Promise.reject(failErr);
      }
    }
    storeForHandler = new FailingStatStore("/root");
  }
  const logger = silentLogger();
  const health = new HealthHandler({ index, store: storeForHandler, logger });
  const files = new FilesHandler({ index, store: storeForHandler, logger });
  const events = new EventsHandler({ watcher: null, logger });
  const app = createApp({
    health,
    files,
    events,
    logger,
    staticAssets: new FakeStaticAssetStore({ brand: "test" }),
    meta: () => ({ watch: false }),
    brand: "test",
  });
  return { app, store, index };
}

Deno.test("GET /health returns 200 status ok", async () => {
  const { app } = await build();
  const res = await app.request("http://local/health");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { status: "ok" });
});

Deno.test("GET /ready returns 200 when content root is readable", async () => {
  const { app } = await build();
  const res = await app.request("http://local/ready");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "ready");
  assertEquals(body.checks.contentRoot, true);
});

Deno.test("GET /ready returns 503 when content root fails", async () => {
  const { app } = await build({ throwOnReady: new Error("disk gone") });
  const res = await app.request("http://local/ready");
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.error.code, "NOT_READY");
  assertEquals(body.checks.contentRoot, false);
});

Deno.test("onError maps PathTraversalError to 400 with envelope", () => {
  const err = new PathTraversalError("escape attempt");
  assertEquals(statusFor(err), 400);
  const body = errorEnvelope(err);
  assertEquals(body.error.code, "PATH_TRAVERSAL");
  assertStringIncludes(body.error.message, "escape");
});

Deno.test("onError maps NotFoundError to 404 with envelope", () => {
  const err = new NotFoundError("missing");
  assertEquals(statusFor(err), 404);
  const body = errorEnvelope(err);
  assertEquals(body.error.code, "NOT_FOUND");
});

Deno.test("unknown route returns HTML shell (SPA fallback)", async () => {
  const { app } = await build();
  const res = await app.request("http://local/nope");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type")?.startsWith("text/html"), true);
});

Deno.test("unhandled (non-AppError) error maps to 500 INTERNAL", () => {
  const err = new Error("kaboom");
  // Non-AppError falls through to default 500 in the handler's onError.
  assertEquals(statusFor(err as unknown as import("../domain/errors.ts").AppError), 500);
});

// ---------- SPA fallback / path-style deep links ----------

Deno.test("GET /<relative-path> returns HTML shell (SPA fallback)", async () => {
  const { app } = await build();
  const res = await app.request("http://local/docs/a.md");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type")?.startsWith("text/html"), true);
});

Deno.test("GET /<dot-path> returns HTML shell for .context-style paths", async () => {
  const { app } = await build();
  const res = await app.request("http://local/.context/plans/PLAN.md");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type")?.startsWith("text/html"), true);
});

Deno.test("GET /api/file/<path> returns JSON not HTML", async () => {
  const store = new FakeFileStore("/root");
  store.add("a.md", "x");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const logger = silentLogger();
  const health = new HealthHandler({ index, store, logger });
  const files = new FilesHandler({ index, store, logger });
  const events = new EventsHandler({ watcher: null, logger });
  const app = createApp({
    health,
    files,
    events,
    logger,
    staticAssets: new FakeStaticAssetStore({ brand: "test" }),
    meta: () => ({ watch: false }),
    brand: "test",
  });
  const res = await app.request("http://local/api/file/a.md");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type")?.startsWith("application/json"), true);
});

Deno.test("GET /content/<path> still returns raw bytes not HTML", async () => {
  const store = new FakeFileStore("/root");
  store.add("a.md", "# hello");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const logger = silentLogger();
  const health = new HealthHandler({ index, store, logger });
  const files = new FilesHandler({ index, store, logger });
  const events = new EventsHandler({ watcher: null, logger });
  const app = createApp({
    health,
    files,
    events,
    logger,
    staticAssets: new FakeStaticAssetStore({ brand: "test" }),
    meta: () => ({ watch: false }),
    brand: "test",
  });
  const res = await app.request("http://local/content/a.md");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/markdown; charset=utf-8");
});

Deno.test("GET /health still returns JSON not HTML", async () => {
  const { app } = await build();
  const res = await app.request("http://local/health");
  assertEquals(res.headers.get("content-type")?.startsWith("application/json"), true);
});

Deno.test("GET /ready still returns JSON not HTML", async () => {
  const { app } = await build();
  const res = await app.request("http://local/ready");
  assertEquals(res.headers.get("content-type")?.startsWith("application/json"), true);
});

Deno.test("GET /api/meta still returns JSON not HTML", async () => {
  const { app } = await build();
  const res = await app.request("http://local/api/meta");
  assertEquals(res.headers.get("content-type")?.startsWith("application/json"), true);
});

Deno.test("GET /ui/app.js still returns JS asset not HTML", async () => {
  const logger = silentLogger();
  const store = new FakeFileStore("/root");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const health = new HealthHandler({ index, store, logger });
  const files = new FilesHandler({ index, store, logger });
  const events = new EventsHandler({ watcher: null, logger });
  const app = createApp({
    health,
    files,
    events,
    logger,
    staticAssets: new FakeStaticAssetStore({
      brand: "test",
      assets: [{
        filename: "app.js",
        content: "console.log('hi');",
        contentType: "application/javascript; charset=utf-8",
      }],
    }),
    meta: () => ({ watch: false }),
    brand: "test",
  });
  const res = await app.request("http://local/ui/app.js");
  assertEquals(res.headers.get("content-type")?.startsWith("application/javascript"), true);
});
