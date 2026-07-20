import { assertEquals } from "jsr:@std/assert@^1";
import { createApp } from "./app.ts";
import { HealthHandler } from "./health_handler.ts";
import { FilesHandler } from "./files_handler.ts";
import { EventsHandler } from "./events_handler.ts";
import { FakeFileStore } from "../adapter/fake_file_store.ts";
import { ContentIndexService } from "../service/content_index_service.ts";
import { ConsoleLogger } from "../adapter/console_logger.ts";
import { WatchCoordinator } from "../service/watch_coordinator.ts";
import type { Logger } from "../ports/logger.ts";
import { FakeStaticAssetStore } from "../adapter/fake_static_asset_store.ts";

function silentLogger(): Logger {
  return new ConsoleLogger({ level: "error", writer: () => {} });
}

Deno.test("GET /api/events returns 404 when watch is disabled", async () => {
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
  const res = await app.request("http://local/api/events");
  assertEquals(res.status, 404);
});

Deno.test("GET /api/events opens SSE stream and broadcasts on watcher reload", async () => {
  const store = new FakeFileStore("/root");
  store.add("a.md", "x");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
  await index.refresh();
  const logger = silentLogger();
  const watcher = new WatchCoordinator(index, logger, { debounceMs: 10 });
  const health = new HealthHandler({ index, store, logger });
  const files = new FilesHandler({ index, store, logger });
  const events = new EventsHandler({ watcher, logger });
  const app = createApp({
    health,
    files,
    events,
    logger,
    staticAssets: new FakeStaticAssetStore({ brand: "test" }),
    meta: () => ({ watch: true }),
    brand: "test",
  });

  // Open the SSE stream
  const res = await app.request("http://local/api/events");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/event-stream");

  // Trigger a reload (simulate FS change)
  await watcher.triggerRefresh();

  // Read the first event from the stream
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  // Read enough bytes to get the first event
  let received = "";
  // Race with a timeout
  const readPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
      if (received.includes("event: reload")) break;
    }
  })();
  const timeout = new Promise<void>((r) => setTimeout(r, 1000));
  await Promise.race([readPromise, timeout]);
  await reader.cancel().catch(() => {});

  // The initial ": connected" should be present, and after trigger, the
  // "event: reload" should also appear.
  if (!received.includes("event: reload")) {
    throw new Error(
      `expected 'event: reload' in SSE stream; got: ${JSON.stringify(received)}`,
    );
  }
});

Deno.test("GET /api/meta returns watch status", async () => {
  const store = new FakeFileStore("/root");
  const index = new ContentIndexService(store, { dotWhitelist: [] });
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
    meta: () => ({ watch: true }),
    brand: "test",
  });
  const res = await app.request("http://local/api/meta");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.watch, true);
});
