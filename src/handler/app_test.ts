import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { createApp } from "./app.ts";
import { HealthHandler } from "./health_handler.ts";
import { FilesHandler } from "./files_handler.ts";
import { EventsHandler } from "./events_handler.ts";
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

Deno.test("onError maps PathTraversalError to 400 with envelope", async () => {
  const { app } = await build();
  app.get("/throw-trav", () => {
    throw new PathTraversalError("escape attempt");
  });
  const res = await app.request("http://local/throw-trav");
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "PATH_TRAVERSAL");
  assertStringIncludes(body.error.message, "escape");
});

Deno.test("onError maps NotFoundError to 404 with envelope", async () => {
  const { app } = await build();
  app.get("/throw-nf", () => {
    throw new NotFoundError("missing");
  });
  const res = await app.request("http://local/throw-nf");
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "NOT_FOUND");
});

Deno.test("unknown route returns 404 with NOT_FOUND envelope", async () => {
  const { app } = await build();
  const res = await app.request("http://local/nope");
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "NOT_FOUND");
});

Deno.test("unhandled (non-AppError) error returns 500 with INTERNAL envelope", async () => {
  const { app } = await build();
  app.get("/boom", () => {
    throw new Error("kaboom");
  });
  const res = await app.request("http://local/boom");
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "INTERNAL");
});
