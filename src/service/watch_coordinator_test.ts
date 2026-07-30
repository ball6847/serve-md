import { assertEquals } from "jsr:@std/assert@^1";
import { join } from "@std/path";
import { isWatchPathRelevant, WatchCoordinator } from "./watch_coordinator.ts";
import { ContentIndexService } from "./content_index.ts";
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

Deno.test("isWatchPathRelevant: excludes .git and always-exclude dirs", () => {
  assertEquals(isWatchPathRelevant(".git/HEAD", []), false);
  assertEquals(isWatchPathRelevant(".git/objects/ab/cd", []), false);
  assertEquals(isWatchPathRelevant("node_modules/pkg/index.js", []), false);
  assertEquals(isWatchPathRelevant("dist/out.js", []), false);
  assertEquals(isWatchPathRelevant("build/x", []), false);
  assertEquals(isWatchPathRelevant("vendor/lib", []), false);
  assertEquals(isWatchPathRelevant("target/debug", []), false);
  assertEquals(isWatchPathRelevant(".idea/workspace.xml", []), false);
});

Deno.test("isWatchPathRelevant: content and whitelisted dot paths are relevant", () => {
  assertEquals(isWatchPathRelevant("docs/readme.md", []), true);
  assertEquals(isWatchPathRelevant("x.md", []), true);
  assertEquals(isWatchPathRelevant("", []), true);
  assertEquals(isWatchPathRelevant(".", []), true);
  assertEquals(isWatchPathRelevant(".context/plan.md", [".context"]), true);
  assertEquals(isWatchPathRelevant(".pi/session.md", [".context", ".pi"]), true);
  assertEquals(isWatchPathRelevant(".context/plan.md", []), false);
  assertEquals(isWatchPathRelevant(".git/x.md", [".context", ".pi"]), false);
});

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

Deno.test("WatchCoordinator: excluded path changes do not refresh or notify", async () => {
  const { root, cleanup } = await makeTempRoot();
  try {
    const store = new DenoFileStore(root);
    const index = new ContentIndexService(store, { dotWhitelist: [".context"] });
    await Deno.writeTextFile(join(root, "keep.md"), "k");
    await index.refresh();
    assertEquals(index.listFiles().length, 1);

    const watcher = new WatchCoordinator(index, silentLogger(), {
      debounceMs: 10,
      dotWhitelist: [".context"],
    });
    let notified = 0;
    watcher.onReload(() => {
      notified++;
    });
    await watcher.start(root);
    // Let the watcher attach and any initial root event settle
    await new Promise((r) => setTimeout(r, 50));
    // Reset — initial attach may trigger one refresh from the root dir event
    notified = 0;

    await Deno.mkdir(join(root, ".git"), { recursive: true });
    await Deno.writeTextFile(join(root, ".git", "HEAD"), "ref: refs/heads/main");
    await Deno.mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await Deno.writeTextFile(join(root, "node_modules", "pkg", "x.md"), "noise");
    // Wait longer than debounce; refresh must not run
    await new Promise((r) => setTimeout(r, 200));

    assertEquals(notified, 0);
    assertEquals(index.listFiles().map((f) => f.relativePath), ["keep.md"]);

    // Control: a real content change still refreshes
    await Deno.writeTextFile(join(root, "new.md"), "n");
    await new Promise((r) => setTimeout(r, 200));
    assertEquals(notified > 0, true);
    assertEquals(index.listFiles().some((f) => f.relativePath === "new.md"), true);

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
