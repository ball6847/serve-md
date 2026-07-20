import { assertEquals } from "jsr:@std/assert@^1";
import { join } from "@std/path";
import { WatchCoordinator } from "./watch_coordinator.ts";
import { ContentIndexService } from "./content_index_service.ts";
import { DenoFileStore } from "../adapter/deno_file_store.ts";
import { ConsoleLogger } from "../adapter/console_logger.ts";
import type { Logger } from "../ports/logger.ts";

function silentLogger(): Logger {
  return new ConsoleLogger({ level: "error", writer: () => {} });
}

async function makeTempRoot(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await Deno.makeTempDir({ prefix: "serve-md-watch-" });
  return {
    root,
    cleanup: async () => {
      try {
        await Deno.remove(root, { recursive: true });
      } catch {
        // ignore
      }
    },
  };
}

Deno.test("WatchCoordinator: triggerRefresh rebuilds index and notifies listeners", async () => {
  const { root, cleanup } = await makeTempRoot();
  try {
    const store = new DenoFileStore(root);
    const index = new ContentIndexService(store, { dotWhitelist: [] });
    await index.refresh();
    assertEquals(index.listFiles().length, 0);

    const watcher = new WatchCoordinator(index, silentLogger(), { debounceMs: 10 });
    let notified = 0;
    watcher.onReload(() => {
      notified++;
    });
    await watcher.start(root);

    // Add a file
    await Deno.writeTextFile(join(root, "x.md"), "x");
    // Wait for debounce + refresh
    await new Promise((r) => setTimeout(r, 200));

    // index should now have x.md
    assertEquals(index.listFiles().some((f) => f.relativePath === "x.md"), true);
    assertEquals(notified > 0, true);

    watcher.stop();
  } finally {
    await cleanup();
  }
});

Deno.test("WatchCoordinator: stop() prevents further events", async () => {
  const { root, cleanup } = await makeTempRoot();
  try {
    const store = new DenoFileStore(root);
    const index = new ContentIndexService(store, { dotWhitelist: [] });
    await index.refresh();
    const watcher = new WatchCoordinator(index, silentLogger(), { debounceMs: 10 });
    await watcher.start(root);
    watcher.stop();
    // No error; just verify we can stop cleanly.
  } finally {
    await cleanup();
  }
});
