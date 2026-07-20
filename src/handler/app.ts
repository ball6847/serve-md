import { Hono } from "hono";
import { HealthHandler } from "./health_handler.ts";
import { FilesHandler } from "./files_handler.ts";
import { EventsHandler } from "./events_handler.ts";
import { errorEnvelope, statusFor } from "./error_mapper.ts";
import { isAppError, PathTraversalError } from "../domain/errors.ts";
import type { Logger } from "../ports/logger.ts";
import type { StaticAssetStore } from "../ports/static_asset_store.ts";
import { PathQuery } from "../api/schemas/files.ts";
import { to } from "await-to-js";

export interface AppDeps {
  health: HealthHandler;
  files: FilesHandler;
  events: EventsHandler;
  logger: Logger;
  staticAssets: StaticAssetStore;
  /** Server-side meta exposed to UI (e.g. watch status). */
  meta: () => { watch: boolean };
  /** Brand name shown in the topbar (e.g. project directory name). */
  brand: string;
}

/**
 * Hono application factory. Constructs the app with all routes registered.
 * Per AGENTS, Handlers are classes — `createApp` wires them.
 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/health", () => deps.health.health());
  app.get("/ready", () => deps.health.ready());

  app.get("/api/meta", () => Response.json({ data: deps.meta() }));

  // Serve index.html for the root
  app.get("/", async () => {
    const html = await deps.staticAssets.readIndex();
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });

  // Serve /ui/* static files (CSS, JS)
  app.get("/ui/:filename", async (c) => {
    const filename = c.req.param("filename");
    const asset = await deps.staticAssets.readAsset(filename);
    return new Response(asset.content, { headers: { "content-type": asset.contentType } });
  });

  // JSON API
  app.get("/api/files", () => deps.files.listFiles());
  app.get("/api/tree", () => deps.files.tree());
  app.get("/api/default-file", () => deps.files.defaultFile());

  app.get("/api/file", async (c) => {
    const raw = Object.fromEntries(new URL(c.req.url).searchParams);
    const parsed = PathQuery.safeParse(raw);
    if (!parsed.success) {
      throw new PathTraversalError("missing or invalid path");
    }
    return await deps.files.fileMeta(parsed.data.path);
  });

  // Raw content (for HTML iframe + relative assets)
  app.get("/content/*", async (c) => {
    // Extract path from the wildcard
    const rest = c.req.path.replace(/^\/content\//, "");
    if (rest.length === 0) {
      throw new PathTraversalError("empty content path");
    }
    const [err] = await to(deps.files.rawContent(rest));
    if (err) {
      if (isAppError(err)) throw err;
      throw err;
    }
    // rawContent returns a Response; need to await. Re-call:
    return await deps.files.rawContent(rest);
  });

  // SSE for watch events
  app.get("/api/events", () => deps.events.events());

  app.onError((err, c) => {
    if (isAppError(err)) {
      deps.logger.error({ errCode: err.code, message: err.message }, "request error");
      return c.json(errorEnvelope(err), statusFor(err) as 400 | 404 | 500 | 503);
    }
    deps.logger.error({ err: String(err) }, "unhandled error");
    return c.json(
      { error: { code: "INTERNAL", message: "internal error" } },
      500,
    );
  });

  app.notFound((c) => {
    return c.json({ error: { code: "NOT_FOUND", message: "route not found" } }, 404);
  });

  return app;
}
