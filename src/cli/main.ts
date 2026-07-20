import { Command } from "cliffy";
import { Hono } from "hono";
import { load } from "dotenv";
import { to } from "await-to-js";
import { parseConfig, type RawFlags } from "../config/load_config.ts";
import type { AppConfig } from "../config/schema.ts";
import { ConfigInvalidError, isAppError } from "../domain/errors.ts";
import { ConsoleLogger } from "../adapter/console_logger.ts";
import { DenoFileStore } from "../adapter/deno_file_store.ts";
import { DenoStaticAssetStore } from "../adapter/deno_static_asset_store.ts";
import { ContentIndexService } from "../service/content_index.ts";
import { HealthHandler } from "../handler/health.ts";
import { FilesHandler } from "../handler/files.ts";
import { EventsHandler } from "../handler/events.ts";
import { MarkdownRenderService } from "../service/markdown_render.ts";
import { WatchCoordinator } from "../service/watch_coordinator.ts";
import { errorEnvelope, statusFor } from "../handler/error_mapper.ts";
import type { Logger } from "../ports/logger.ts";
import type { StaticAssetStore } from "../ports/static_asset_store.ts";

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

/** Extract the wildcard portion of a splat route path. */
function extractSplat(path: string, prefix: string): string {
  if (path === prefix) return "";
  if (path.startsWith(prefix + "/")) return path.slice(prefix.length + 1);
  return path.slice(prefix.length);
}

/**
 * Hono application factory. Constructs the app with all routes registered.
 * Per AGENTS, Handlers are classes — this wires them to Hono routes.
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

  // Path-style file metadata: GET /api/file/<relative-path>
  app.get("/api/file/*", async (c) => {
    const rest = extractSplat(c.req.path, "/api/file");
    if (rest.length === 0) {
      throw new (await import("../domain/errors.ts")).PathTraversalError("empty file path");
    }
    return await deps.files.fileMeta(rest);
  });

  // Raw content (for HTML iframe + relative assets)
  app.get("/content/*", async (c) => {
    const rest = extractSplat(c.req.path, "/content");
    if (rest.length === 0) {
      throw new (await import("../domain/errors.ts")).PathTraversalError("empty content path");
    }
    const [err] = await to(deps.files.rawContent(rest));
    if (err) {
      if (isAppError(err)) throw err;
      throw err;
    }
    return await deps.files.rawContent(rest);
  });

  // SSE for watch events
  app.get("/api/events", () => deps.events.events());

  // SPA fallback: any non-reserved GET path serves the reader shell.
  // Registered last so reserved routes (/api/*, /content/*, /ui/*, /health, /ready)
  // take priority. The client then loads the file via the JSON API and shows
  // an in-app error if the file is missing (same UX as a missing file today).
  app.get("/*", async () => {
    const html = await deps.staticAssets.readIndex();
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });

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

/**
 * Composition root. Builds config + services, refreshes the index, and
 * starts Deno.serve with the Hono app.
 */
export async function main(argv: string[]): Promise<number> {
  await load({ export: true, envPath: ".env" });

  let exitCode = 0;
  await new Command()
    .name("serve-md")
    .description("Local Glow-for-web Markdown/HTML reader")
    .command("serve", "Run the HTTP server")
    .option("--port <port:number>", "Port to listen on (env PORT)", { default: undefined })
    .option("--network", "Bind to 0.0.0.0 (all interfaces)", { default: false })
    .option("-w, --watch", "Watch content root for changes", { default: false })
    .option("--root <root:string>", "Content root directory (default: cwd)", {
      default: undefined,
    })
    .option("--open", "Open browser automatically on startup", { default: false })
    .action(async (options) => {
      const flags: RawFlags = {
        port: options.port as number | undefined,
        network: Boolean(options.network),
        watch: Boolean(options.watch),
        open: Boolean(options.open),
        root: options.root as string | undefined,
      };
      const result = parseConfig({
        flags,
        env: Deno.env.toObject(),
        cwd: Deno.cwd(),
      });

      if (isAppError(result)) {
        const err = result as ConfigInvalidError;
        console.error(`[CONFIG_INVALID] ${err.message}`);
        if (err.context?.issues) {
          for (
            const issue of err.context.issues as Array<
              { path: (string | number)[]; message: string }
            >
          ) {
            console.error(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
          }
        }
        exitCode = 2;
        return;
      }

      const config: AppConfig = result;
      // Logger is sync; configure it for the chosen level
      const logger: Logger = new ConsoleLogger({ level: config.logLevel });
      logger.info(
        {
          contentRoot: config.contentRoot,
          host: config.host,
          port: config.port,
          watch: config.watch,
          logLevel: config.logLevel,
          dotWhitelist: config.dotWhitelist,
        },
        "serve config ok",
      );

      // Composition: FileStore → ContentIndexService → Handlers → Hono app
      const store = new DenoFileStore(config.contentRoot);
      const index = new ContentIndexService(store, { dotWhitelist: config.dotWhitelist });
      const renderer = new MarkdownRenderService();
      const health = new HealthHandler({ index, store, logger });
      const files = new FilesHandler({ index, store, logger, renderer });

      // Watch is opt-in via -w/--watch. When enabled, the WatchCoordinator
      // refreshes the index on filesystem changes, and the EventsHandler
      // exposes an SSE stream so the UI can reload.
      const watcher = config.watch
        ? new WatchCoordinator(index, logger.child({ component: "watch" }))
        : null;
      if (watcher) {
        await watcher.start(config.contentRoot);
      }
      const events = new EventsHandler({ watcher, logger });
      const staticAssets = new DenoStaticAssetStore(
        config.contentRoot.split("/").pop() || "serve-md",
      );
      const app = createApp({
        health,
        files,
        events,
        logger,
        staticAssets,
        meta: () => ({ watch: Boolean(watcher) }),
        brand: config.contentRoot.split("/").pop() || "serve-md",
      });

      // Initial index refresh (best-effort; ready will report failure)
      void (async () => {
        const [err] = await to(index.refresh());
        if (err) {
          logger.warn(
            { errCode: "READ_FAILED", reason: err.message },
            "initial index refresh failed; ready will report 503",
          );
        } else {
          logger.info(
            { files: index.listFiles().length },
            "initial index ready",
          );
        }
      })();

      // Listen. Plan 05: Hono fetch handler. We keep the process alive by
      // awaiting the server's `finished` promise (resolves when the server
      // closes) so `Deno.exit` at the bottom of main() does not terminate
      // the server prematurely.
      const server = Deno.serve(
        {
          hostname: config.host,
          port: config.port,
          onListen: ({ hostname, port }) => {
            logger.info({ hostname, port }, "http server listening");
            // Open browser if --open flag was set
            if (config.open) {
              const url = `http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}`;
              const cmd = Deno.build.os === "darwin"
                ? "open"
                : Deno.build.os === "windows"
                ? "cmd"
                : "xdg-open";
              const args = Deno.build.os === "windows" ? ["/c", "start", url] : [url];
              try {
                new Deno.Command(cmd, { args }).spawn();
              } catch (e) {
                logger.warn({ err: String(e) }, "failed to open browser");
              }
            }
          },
        },
        app.fetch,
      );
      // Stash the server promise in a shared holder so main() can await it.
      runState.serverFinished = server.finished;
    })
    .parse(argv);

  // If the action started an HTTP server, wait for it to finish so we don't
  // exit prematurely. Otherwise (e.g. --help), just return.
  if (runState.serverFinished) {
    await runState.serverFinished;
  }
  return exitCode;
}

/** Mutable shared state used by the cliffy action and the main wrapper. */
const runState: { serverFinished: Promise<void> | null } = {
  serverFinished: null,
};

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
