import type { Logger } from "../ports/logger.ts";
import type { WatchCoordinator } from "../service/watchCoordinator.ts";

/**
 * Server-Sent Events handler. Per plan 10:
 *   - When watch is enabled, the client opens an EventSource on /api/events.
 *   - Server emits `event: reload` whenever the index refreshes.
 *   - When watch is disabled, the endpoint returns 404 (no idle connections).
 */
export interface EventsHandlerDeps {
  watcher: WatchCoordinator | null;
  logger: Logger;
}

export class EventsHandler {
  readonly #deps: EventsHandlerDeps;
  #sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  constructor(deps: EventsHandlerDeps) {
    this.#deps = deps;
    if (deps.watcher) {
      deps.watcher.onReload(() => this.#broadcast());
    }
  }

  /** GET /api/events — SSE stream, or 404 if watch is disabled. */
  events(): Response {
    if (!this.#deps.watcher) {
      return new Response("not found", { status: 404 });
    }
    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#sseClients.add(controller);
        // initial comment to flush headers
        controller.enqueue(encoder.encode(`: connected\n\n`));
        cleanup = () => {
          this.#sseClients.delete(controller);
          try {
            controller.close();
          } catch {
            // ignore
          }
        };
      },
      cancel: () => {
        cleanup?.();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      },
    });
  }

  #broadcast(): void {
    const encoder = new TextEncoder();
    for (const c of this.#sseClients) {
      try {
        c.enqueue(encoder.encode(`event: reload\ndata: {"reason":"fs"}\n\n`));
      } catch {
        // dead client
        this.#sseClients.delete(c);
      }
    }
  }
}
