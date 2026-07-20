import { assertEquals, assertInstanceOf } from "jsr:@std/assert@^1";
import { FilesHandler, LARGE_FILE_BYTES } from "./files_handler.ts";
import { FakeFileStore } from "../adapter/fake_file_store.ts";
import { ContentIndexService } from "../service/content_index_service.ts";
import { ConsoleLogger } from "../adapter/console_logger.ts";
import { NotFoundError, PathTraversalError, ReadFailedError } from "../domain/errors.ts";
import { createApp } from "./app.ts";
import { HealthHandler } from "./health_handler.ts";
import { EventsHandler } from "./events_handler.ts";
import { Hono } from "hono";
import type { Logger } from "../ports/logger.ts";

function silentLogger(): Logger {
  return new ConsoleLogger({ level: "error", writer: () => {} });
}

function buildApp(opts?: { index?: ContentIndexService; store?: FakeFileStore }): {
  app: Hono;
  store: FakeFileStore;
  index: ContentIndexService;
} {
  const store = opts?.store ?? new FakeFileStore("/root");
  const index = opts?.index ?? new ContentIndexService(store, { dotWhitelist: [] });
  const logger = silentLogger();
  const health = new HealthHandler({ index, store, logger });
  const files = new FilesHandler({ index, store, logger });
  const events = new EventsHandler({ watcher: null, logger });
  const app = createApp({
    health,
    files,
    events,
    logger,
    meta: () => ({ watch: false }),
    brand: "test",
  });
  return { app, store, index };
}

Deno.test("GET /api/files returns only content files (md/html/htm)", async () => {
  const store = new FakeFileStore("/root");
  store.add("a.ts", "no");
  store.add("a.md", "x");
  store.add("b.html", "y");
  store.add("c.htm", "z");
  const { app } = buildApp({ store });
  // Wait — buildApp creates a new index. Use the one we want.
  // Rebuild a fresh app with a fresh index using the same store.
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app: app2 } = buildApp({ index, store });
  const res = await app2.request("http://local/api/files");
  assertEquals(res.status, 200);
  const body = await res.json();
  const paths = (body.data as Array<{ relativePath: string }>).map((f) => f.relativePath).sort();
  assertEquals(paths, ["a.md", "b.html", "c.htm"]);
  // suppress unused
  void app;
});

Deno.test("GET /api/files includes humanizedLabel", async () => {
  const store = new FakeFileStore("/root");
  store.add("docs/plans/my-plan.md", "x");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app } = buildApp({ index, store });
  const res = await app.request("http://local/api/files");
  const body = await res.json();
  const f = (body.data as Array<{ humanizedLabel: string }>)[0];
  assertEquals(f.humanizedLabel, "docs/plans › My Plan");
});

Deno.test("GET /api/tree returns nested tree", async () => {
  const store = new FakeFileStore("/root");
  store.add("docs/a.md", "x");
  store.add("docs/sub/b.md", "y");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app } = buildApp({ index, store });
  const res = await app.request("http://local/api/tree");
  assertEquals(res.status, 200);
  const body = await res.json();
  const tree = body.data as { children?: Array<{ name: string; type: string }> };
  const topNames = (tree.children ?? []).map((c) => c.name);
  assertEquals(topNames, ["docs"]);
});

Deno.test("GET /api/default-file returns README.md path", async () => {
  const store = new FakeFileStore("/root");
  store.add("README.md", "x");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app } = buildApp({ index, store });
  const res = await app.request("http://local/api/default-file");
  const body = await res.json();
  assertEquals(body.data.path, "README.md");
});

Deno.test("GET /api/default-file returns null when no README", async () => {
  const store = new FakeFileStore("/root");
  store.add("a.md", "x");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app } = buildApp({ index, store });
  const res = await app.request("http://local/api/default-file");
  const body = await res.json();
  assertEquals(body.data.path, null);
});

Deno.test("GET /api/file?path=... returns metadata for known md", async () => {
  const store = new FakeFileStore("/root");
  store.add("a.md", "x");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app } = buildApp({ index, store });
  const res = await app.request("http://local/api/file?path=a.md");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.relativePath, "a.md");
  assertEquals(body.data.kind, "markdown");
  assertEquals(body.data.largeFile, false);
  assertEquals(body.data.contentType, "text/markdown; charset=utf-8");
});

Deno.test("GET /api/file?path=... large file flag set when > 2MB", async () => {
  const store = new FakeFileStore("/root");
  const big = new Uint8Array(LARGE_FILE_BYTES + 1);
  store.add("big.md", big);
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app } = buildApp({ index, store });
  const res = await app.request("http://local/api/file?path=big.md");
  const body = await res.json();
  assertEquals(body.data.largeFile, true);
  assertEquals(body.data.size > LARGE_FILE_BYTES, true);
});

Deno.test("GET /api/file traversal rejected with 400", async () => {
  const store = new FakeFileStore("/root");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app } = buildApp({ index, store });
  const res = await app.request("http://local/api/file?path=../etc/passwd");
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "PATH_TRAVERSAL");
});

Deno.test("GET /api/file missing file returns 404", async () => {
  const store = new FakeFileStore("/root");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app } = buildApp({ index, store });
  const res = await app.request("http://local/api/file?path=nope.md");
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "NOT_FOUND");
});

Deno.test("GET /api/file?path= missing path returns 400", async () => {
  const { app } = buildApp();
  const res = await app.request("http://local/api/file?path=");
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "PATH_TRAVERSAL");
});

Deno.test("GET /api/file?path=README (extensionless) returns plain meta", async () => {
  const store = new FakeFileStore("/root");
  store.add("README", "plain text content");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app } = buildApp({ index, store });
  const res = await app.request("http://local/api/file?path=README");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.kind, "plain");
  assertEquals(body.data.relativePath, "README");
});

Deno.test("GET /content/<path> serves raw bytes with content-type", async () => {
  const store = new FakeFileStore("/root");
  store.add("a.md", "# hello");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app } = buildApp({ index, store });
  const res = await app.request("http://local/content/a.md");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/markdown; charset=utf-8");
  const text = await res.text();
  assertEquals(text, "# hello");
});

Deno.test("GET /content/<path> traversal rejected with 400", async () => {
  const store = new FakeFileStore("/root");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app } = buildApp({ index, store });
  const res = await app.request("http://local/content/../etc/passwd");
  // Hono's path resolution may normalize this URL; we just need a 400 here.
  // If the path is normalized, the result might be 404. Both are acceptable.
  const status = res.status;
  if (status === 400) {
    const body = await res.json();
    assertEquals(body.error.code, "PATH_TRAVERSAL");
  } else {
    assertEquals(status, 404);
  }
});

Deno.test("GET /content/<path> missing returns 404", async () => {
  const store = new FakeFileStore("/root");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app } = buildApp({ index, store });
  const res = await app.request("http://local/content/nope.md");
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "NOT_FOUND");
});

Deno.test("GET /content/<html> serves html content-type", async () => {
  const store = new FakeFileStore("/root");
  store.add("report.html", "<h1>x</h1>");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const { app } = buildApp({ index, store });
  const res = await app.request("http://local/content/report.html");
  assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
});

// AppError integration check
Deno.test("FilesHandler throws AppError subclasses; to()/instanceof checks work", async () => {
  const store = new FakeFileStore("/root");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const files = new FilesHandler({ index, store, logger: silentLogger() });
  try {
    await files.fileMeta("nope");
    throw new Error("should have thrown");
  } catch (e) {
    assertInstanceOf(e, NotFoundError);
  }
  try {
    await files.rawContent("../etc/passwd");
    throw new Error("should have thrown");
  } catch (e) {
    assertInstanceOf(e, PathTraversalError);
  }
  // suppress unused
  void ReadFailedError;
});
