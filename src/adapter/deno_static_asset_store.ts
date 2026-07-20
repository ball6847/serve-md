import { join } from "@std/path";
import { NotFoundError, PathTraversalError, ReadFailedError } from "../domain/errors.ts";
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
 * appropriate sentinel.
 */
export class DenoStaticAssetStore implements StaticAssetStore {
  readonly #baseDir: string;
  readonly #brand: string;

  constructor(brand: string) {
    this.#baseDir = new URL("../ui/", import.meta.url).pathname;
    this.#brand = brand;
  }

  async readIndex(): Promise<string> {
    const abs = join(this.#baseDir, "index.html");
    try {
      let html = await Deno.readTextFile(abs);
      html = html.replace(/\{\{ brand \}\}/g, escapeHtml(this.#brand));
      return html;
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new NotFoundError("index.html not found", { cause: e });
      }
      throw new ReadFailedError("read index.html failed", { cause: e });
    }
  }

  async readAsset(
    filename: string,
  ): Promise<{ content: string; contentType: string }> {
    // Validate filename: no path traversal, flat only, allowed extensions.
    this.#validateFilename(filename);

    const abs = join(this.#baseDir, filename);
    const contentType = filename.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "application/javascript; charset=utf-8";

    try {
      const content = await Deno.readTextFile(abs);
      return { content, contentType };
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new NotFoundError(`static asset not found: ${filename}`, { cause: e });
      }
      throw new ReadFailedError(`read asset failed: ${filename}`, { cause: e });
    }
  }

  #validateFilename(filename: string): void {
    // Reject empty, path separators, parent refs, and disallowed extensions.
    if (!filename || filename.includes("/") || filename.includes("\\")) {
      throw new PathTraversalError("invalid static filename");
    }
    if (filename.includes("..")) {
      throw new PathTraversalError("invalid static filename");
    }
    const lower = filename.toLowerCase();
    if (!lower.endsWith(".css") && !lower.endsWith(".js")) {
      throw new PathTraversalError("static asset must be .css or .js");
    }
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
