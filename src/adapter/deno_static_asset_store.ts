import { join } from "@std/path";
import { to } from "await-to-js";
import { AppError, NotFoundError, PathTraversalError, ReadFailedError } from "../domain/errors.ts";
import type { StaticAssetStore } from "../ports/static_asset_store.ts";

/**
 * Deno-backed StaticAssetStore.
 *
 * Behavior depends on where the module is loaded from at runtime:
 *
 * - Development / local install (`file://`): assets are read from `src/ui/` on
 *   the local filesystem using `Deno.readTextFile`.
 * - JSR / remote install (`https://`): assets are fetched from the same JSR
 *   version that the module was loaded from. The version is pinned implicitly
 *   because `import.meta.url` contains the resolved version (e.g.
 *   `https://jsr.io/@ball6847/serve-md/1.0.2/src/adapter/...`). Fetched assets
 *   are cached in memory for the lifetime of the process.
 *
 * Only `.css` and `.js` files are served via `readAsset`; `readIndex` serves
 * `index.html` with the `{{ brand }}` placeholder replaced.
 *
 * AGENTS: no try/catch — we map errors to `AppError` subclasses and return the
 * sentinel as a value.
 */
export class DenoStaticAssetStore implements StaticAssetStore {
  readonly #baseDir: string;
  readonly #baseUrl: URL;
  readonly #brand: string;
  readonly #cache: Map<string, { content: string; contentType: string }>;
  readonly #fetch: (input: URL) => Promise<Response>;
  readonly #mode: "local" | "remote";

  constructor(
    brand: string,
    options: {
      /** Override the module URL used to resolve the UI base path. */
      moduleUrl?: string | URL;
      /** Override the fetch implementation (used in tests). */
      fetch?: (input: URL) => Promise<Response>;
    } = {},
  ) {
    const moduleUrl = new URL(options.moduleUrl ?? import.meta.url);
    this.#brand = brand;
    this.#mode = moduleUrl.protocol === "file:" ? "local" : "remote";
    this.#baseUrl = new URL("../ui/", moduleUrl);
    this.#baseDir = this.#baseUrl.pathname;
    this.#cache = new Map();
    this.#fetch = options.fetch ?? fetch;
  }

  /** Current serving mode, useful for logging in the composition root. */
  get mode(): "local" | "remote" {
    return this.#mode;
  }

  /** Base URL used for remote fetches; includes the pinned JSR version. */
  get baseUrl(): URL {
    return new URL(this.#baseUrl);
  }

  async readIndex(): Promise<string | AppError> {
    const result = await this.#readAsset("index.html");
    if (result instanceof AppError) {
      return result;
    }
    return result.content.replace(/\{\{ brand \}\}/g, escapeHtml(this.#brand));
  }

  readAsset(
    filename: string,
  ): Promise<{ content: string; contentType: string } | AppError> {
    const validationErr = this.#validateFilename(filename);
    if (validationErr) {
      return Promise.resolve(validationErr);
    }
    return this.#readAsset(filename);
  }

  #readAsset(
    filename: string,
  ): Promise<{ content: string; contentType: string } | AppError> {
    if (this.#mode === "local") {
      return this.#readLocal(filename);
    }
    return this.#readRemote(filename);
  }

  async #readLocal(
    filename: string,
  ): Promise<{ content: string; contentType: string } | AppError> {
    const abs = join(this.#baseDir, filename);
    const contentType = this.#contentTypeFor(filename);

    const [err, content] = await to(Deno.readTextFile(abs));
    if (err) {
      if (err instanceof Deno.errors.NotFound) {
        return new NotFoundError(`static asset not found: ${filename}`, { cause: err });
      }
      return new ReadFailedError(`read asset failed: ${filename}`, { cause: err });
    }
    return { content, contentType };
  }

  async #readRemote(
    filename: string,
  ): Promise<{ content: string; contentType: string } | AppError> {
    const cached = this.#cache.get(filename);
    if (cached) {
      return cached;
    }

    const url = new URL(filename, this.#baseUrl);
    const [err, res] = await to(this.#fetch(url));
    if (err) {
      return new ReadFailedError(
        `fetch asset failed: ${filename} (ensure --allow-net includes ${url.host})`,
        { cause: err },
      );
    }
    if (!res.ok) {
      if (res.status === 404) {
        return new NotFoundError(`static asset not found: ${filename}`);
      }
      return new ReadFailedError(`fetch asset returned ${res.status}: ${filename}`);
    }

    const contentType = this.#contentTypeFor(filename);
    const [textErr, content] = await to(res.text());
    if (textErr) {
      return new ReadFailedError(`read asset response failed: ${filename}`, { cause: textErr });
    }

    const asset = { content, contentType };
    this.#cache.set(filename, asset);
    return asset;
  }

  #validateFilename(filename: string): AppError | null {
    // Reject empty, path separators, parent refs, and disallowed extensions.
    if (!filename || filename.includes("/") || filename.includes("\\")) {
      return new PathTraversalError("invalid static filename");
    }
    if (filename.includes("..")) {
      return new PathTraversalError("invalid static filename");
    }
    const lower = filename.toLowerCase();
    if (!lower.endsWith(".css") && !lower.endsWith(".js")) {
      return new PathTraversalError("static asset must be .css or .js");
    }
    return null;
  }

  #contentTypeFor(filename: string): string {
    return filename.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "application/javascript; charset=utf-8";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
