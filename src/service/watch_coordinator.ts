import type { Logger } from "../ports/logger.ts";
import { to } from "await-to-js";
import { ReadFailedError } from "../domain/errors.ts";
import type { ContentIndexService } from "./content_index_service.ts";

export interface WatchOptions {
  /** Debounce window in ms. */
  debounceMs?: number;
}

/**
 * Watches the content root for filesystem changes and refreshes the index.
 * Emits "change" notifications via the registered callback.
 *
 * Uses Deno.watchFs under the hood. Debounces bursts of events.
 *
 * Lifecycle: call `start()` to begin watching, `stop()` to clean up.
 */
export class WatchCoordinator {
  readonly #index: ContentIndexService;
  readonly #logger: Logger;
  readonly #debounceMs: number;
  #watcher: Deno.FsWatcher | null = null;
  #timer: number | null = null;
  #listeners: Array<() => void> = [];

  constructor(index: ContentIndexService, logger: Logger, options: WatchOptions = {}) {
    this.#index = index;
    this.#logger = logger;
    this.#debounceMs = options.debounceMs ?? 200;
  }

  onReload(listener: () => void): void {
    this.#listeners.push(listener);
  }

  start(contentRoot: string): Promise<void> {
    (async () => {
      try {
        this.#watcher = Deno.watchFs(contentRoot, { recursive: true });
        this.#logger.info({ contentRoot }, "watch started");
        await this.#loop();
      } catch (e) {
        this.#logger.warn({ err: String(e) }, "watch start failed");
      }
    })();
    return Promise.resolve();
  }

  stop(): void {
    if (this.#watcher) {
      try {
        this.#watcher.close();
      } catch {
        // ignore
      }
      this.#watcher = null;
    }
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async #loop(): Promise<void> {
    if (!this.#watcher) return;
    for await (const _event of this.#watcher) {
      // any event — debounce
      if (this.#timer !== null) clearTimeout(this.#timer);
      this.#timer = setTimeout(() => {
        void this.#refresh();
      }, this.#debounceMs) as unknown as number;
    }
  }

  async #refresh(): Promise<void> {
    const [err] = await to(this.#index.refresh());
    if (err) {
      const re = err instanceof ReadFailedError
        ? err
        : new ReadFailedError("watch refresh failed", { cause: err });
      this.#logger.warn({ errCode: re.code, reason: re.message }, "watch refresh failed");
    } else {
      this.#logger.info({ files: this.#index.listFiles().length }, "watch refresh ok");
    }
    for (const l of this.#listeners) {
      try {
        l();
      } catch {
        // ignore listener errors
      }
    }
  }

  /** Manually trigger a refresh (used by tests). */
  async triggerRefresh(): Promise<void> {
    await this.#refresh();
  }
}
