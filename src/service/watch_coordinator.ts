import { relative, SEPARATOR } from "@std/path";
import type { Logger } from "../ports/logger.ts";
import { to } from "await-to-js";
import { ContentPath } from "../domain/content_path.ts";
import { ReadFailedError } from "../domain/errors.ts";
import { trySync } from "../utils/try_sync.ts";
import type { ContentIndexService } from "./content_index.ts";

export interface WatchOptions {
  /** Debounce window in ms. */
  debounceMs?: number;
  /**
   * Dot-directory basenames allowed in the content index (same as index).
   * Used to decide whether a watch event should trigger a refresh.
   */
  dotWhitelist?: string[];
}

/**
 * True if a path relative to the content root should trigger a watch refresh.
 *
 * Uses the same exclusion policy as the content index: dot segments (unless
 * whitelisted) and always-exclude basenames (`node_modules`, `dist`, …).
 * The content root itself (`""` / `"."`) is always relevant.
 */
export function isWatchPathRelevant(
  relativePath: string,
  dotWhitelist: string[],
): boolean {
  if (relativePath === "" || relativePath === ".") {
    return true;
  }
  return !new ContentPath(relativePath).isExcluded(dotWhitelist);
}

/**
 * Watches the content root for filesystem changes and refreshes the index.
 * Emits "change" notifications via the registered callback.
 *
 * Uses Deno.watchFs under the hood. Debounces bursts of events.
 * Events whose paths are all excluded (dot dirs, vendor dirs) are ignored.
 *
 * Lifecycle: call `start()` to begin watching, `stop()` to clean up.
 */
export class WatchCoordinator {
  readonly #index: ContentIndexService;
  readonly #logger: Logger;
  readonly #debounceMs: number;
  readonly #dotWhitelist: string[];
  #contentRoot = "";
  #watcher: Deno.FsWatcher | null = null;
  #timer: number | null = null;
  #listeners: Array<() => void> = [];

  constructor(index: ContentIndexService, logger: Logger, options: WatchOptions = {}) {
    this.#index = index;
    this.#logger = logger;
    this.#debounceMs = options.debounceMs ?? 1000;
    this.#dotWhitelist = options.dotWhitelist ?? [];
  }

  onReload(listener: () => void): void {
    this.#listeners.push(listener);
  }

  start(contentRoot: string): Promise<void> {
    this.#contentRoot = contentRoot;
    (async () => {
      // Deno.watchFs() is synchronous — use trySync for consistent error handling.
      const [watchErr, watcher] = trySync(() => Deno.watchFs(contentRoot, { recursive: true }));
      if (watchErr) {
        this.#logger.warn({ err: String(watchErr) }, "watch fs init failed");
        return;
      }
      this.#watcher = watcher;
      const [err] = await to(this.#loop());
      if (err) {
        this.#logger.warn({ err: String(err) }, "watch loop failed");
      } else {
        this.#logger.info({ contentRoot }, "watch started");
      }
    })();
    return Promise.resolve();
  }

  stop(): void {
    if (this.#watcher) {
      // Synchronous cleanup — use trySync to swallow errors consistently.
      trySync(() => this.#watcher!.close());
      this.#watcher = null;
    }
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async #loop(): Promise<void> {
    if (!this.#watcher) {
      return;
    }
    for await (const event of this.#watcher) {
      if (!this.#eventIsRelevant(event)) {
        // Silent: excluded paths (.git, node_modules, …) are expected noise.
        continue;
      }
      // Relevant event — debounce bursts
      if (this.#timer !== null) {
        clearTimeout(this.#timer);
      }
      this.#timer = setTimeout(() => {
        void this.#refresh();
      }, this.#debounceMs) as unknown as number;
    }
  }

  /**
   * Refresh if any event path is not excluded. Empty path list is treated as
   * relevant (conservative — some platforms omit paths).
   */
  #eventIsRelevant(event: Deno.FsEvent): boolean {
    if (event.paths.length === 0) {
      return true;
    }
    for (const abs of event.paths) {
      const rel = this.#toRelative(abs);
      if (rel === null) {
        continue;
      }
      if (isWatchPathRelevant(rel, this.#dotWhitelist)) {
        return true;
      }
    }
    return false;
  }

  /** Map absolute FS path to posix-relative under content root, or null if outside. */
  #toRelative(absPath: string): string | null {
    const [err, relNative] = trySync(() => relative(this.#contentRoot, absPath));
    if (err) {
      return null;
    }
    if (relNative.startsWith("..") || relNative === "..") {
      return null;
    }
    if (SEPARATOR === "/") {
      return relNative;
    }
    return relNative.split(SEPARATOR).join("/");
  }

  async #refresh(): Promise<void> {
    const err = await this.#index.refresh();
    if (err) {
      const re = err instanceof ReadFailedError
        ? err
        : new ReadFailedError("watch refresh failed", { cause: err });
      this.#logger.warn({ errCode: re.code, reason: re.message }, "watch refresh failed");
    } else {
      this.#logger.info({ files: this.#index.listFiles().length }, "watch refresh ok");
    }
    for (const l of this.#listeners) {
      // Synchronous listener callback — use trySync to swallow errors consistently.
      trySync(() => l());
    }
  }

  /** Manually trigger a refresh (used by tests). */
  async triggerRefresh(): Promise<void> {
    await this.#refresh();
  }
}
