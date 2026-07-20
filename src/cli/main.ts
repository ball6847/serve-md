import { Command } from "cliffy";
import { load } from "dotenv";
import { to } from "await-to-js";
import { parseConfig, type RawFlags } from "../config/load_config.ts";
import type { AppConfig } from "../config/schema.ts";
import { ConfigInvalidError, isAppError } from "../domain/errors.ts";
import { ConsoleLogger } from "../adapter/console_logger.ts";
import { DenoFileStore } from "../adapter/deno_file_store.ts";
import { DenoStaticAssetStore } from "../adapter/deno_static_asset_store.ts";
import { ContentIndexService } from "../service/content_index_service.ts";
import { HealthHandler } from "../handler/health_handler.ts";
import { FilesHandler } from "../handler/files_handler.ts";
import { EventsHandler } from "../handler/events_handler.ts";
import { MarkdownRenderService } from "../service/markdown_render_service.ts";
import { WatchCoordinator } from "../service/watch_coordinator.ts";
import { createApp } from "../handler/app.ts";
import type { Logger } from "../ports/logger.ts";

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
