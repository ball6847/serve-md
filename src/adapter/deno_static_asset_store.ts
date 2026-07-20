import { join } from "@std/path";
import { to } from "await-to-js";
import { AppError, NotFoundError, PathTraversalError, ReadFailedError } from "../domain/errors.ts";
import type { StaticAssetStore } from "../ports/static_asset_store.ts";

/**
 * Deno-backed StaticAssetStore.
 *
 * Assets live under `src/ui/` relative to this file. Only `.css` and `.js`
 * files are served via `readAsset`; `readIndex` serves `index.html` with
 * the `{{ brand }}` placeholder replaced.
 *
 * AGENTS: no try/catch — we map Deno errors to `AppError` subclasses via
 * explicit checks (`instanceof Deno.errors.NotFound`, etc.) and return the
 * appropriate sentinel as a value (not thrown).
 */
export class DenoStaticAssetStore implements StaticAssetStore {
  readonly #baseDir: string;
  readonly #brand: string;

  constructor(brand: string) {
    this.#baseDir = new URL("../ui/", import.meta.url).pathname;
    this.#brand = brand;
  }

  async readIndex(): Promise<string | AppError> {
    const abs = join(this.#baseDir, "index.html");
    const [err, html] = await to(Deno.readTextFile(abs));
    if (err) {
      if (err instanceof Deno.errors.NotFound) {
        return new NotFoundError("index.html not found", { cause: err });
      }
      return new ReadFailedError("read index.html failed", { cause: err });
    }
    return html.replace(/\{\{ brand \}\}/g, escapeHtml(this.#brand));
  }

  async readAsset(
    filename: string,
  ): Promise<{ content: string; contentType: string } | AppError> {
    // Validate filename: no path traversal, flat only, allowed extensions.
    const validationErr = this.#validateFilename(filename);
    if (validationErr) {
      return validationErr;
    }

    const abs = join(this.#baseDir, filename);
    const contentType = filename.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "application/javascript; charset=utf-8";

    const [err, content] = await to(Deno.readTextFile(abs));
    if (err) {
      if (err instanceof Deno.errors.NotFound) {
        return new NotFoundError(`static asset not found: ${filename}`, { cause: err });
      }
      return new ReadFailedError(`read asset failed: ${filename}`, { cause: err });
    }
    return { content, contentType };
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
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
