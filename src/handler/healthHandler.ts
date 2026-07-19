import type { ContentIndexService } from "../service/contentIndexService.ts";
import type { FileStore } from "../ports/fileStore.ts";
import type { Logger } from "../ports/logger.ts";
import { NotReadyError } from "../domain/errors.ts";
import { to } from "await-to-js";

export interface HealthDeps {
  index: ContentIndexService;
  store: FileStore;
  logger: Logger;
}

export class HealthHandler {
  readonly #deps: HealthDeps;
  constructor(deps: HealthDeps) {
    this.#deps = deps;
  }

  /** GET /health — liveness only, always 200 if the process is alive. */
  health(): Response {
    return Response.json({ status: "ok" });
  }

  /** GET /ready — 200 if content root is readable, else 503. */
  async ready(): Promise<Response> {
    const [err] = await to(this.#deps.store.stat("."));
    if (err) {
      this.#deps.logger.warn(
        { errCode: "NOT_READY", reason: String(err) },
        "ready check failed",
      );
      const body = {
        error: {
          code: "NOT_READY",
          message: "content root not readable",
        },
        checks: { contentRoot: false },
      };
      return new Response(JSON.stringify(body), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    // Also ensure index has a valid prior state OR a fresh refresh works
    if (this.#deps.index.listFiles().length === 0 && this.#deps.index.lastError() !== null) {
      const ne = new NotReadyError("index never loaded", {
        cause: this.#deps.index.lastError() ?? undefined,
      });
      return new Response(
        JSON.stringify({
          error: { code: ne.code, message: ne.message },
          checks: { contentRoot: true, index: false },
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return Response.json({ status: "ready", checks: { contentRoot: true, index: true } });
  }
}
