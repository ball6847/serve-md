import type { StaticAssetStore } from "../ports/static_asset_store.ts";
import { AppError, NotFoundError, PathTraversalError } from "../domain/errors.ts";

/**
 * Fake StaticAssetStore for testing.
 *
 * Returns canned HTML for readIndex() and canned content for readAsset().
 * Useful for handler tests that don't need real file I/O.
 *
 * AGENTS: errors are returned as values (not thrown), matching the real adapter.
 */
export class FakeStaticAssetStore implements StaticAssetStore {
  readonly #brand: string;
  readonly #assets: Map<string, { content: string; contentType: string }>;

  constructor(opts?: {
    brand?: string;
    assets?: Array<{ filename: string; content: string; contentType: string }>;
  }) {
    this.#brand = opts?.brand ?? "test-brand";
    this.#assets = new Map(
      (opts?.assets ?? []).map((
        a,
      ) => [a.filename, { content: a.content, contentType: a.contentType }]),
    );
  }

  async readIndex(): Promise<string | AppError> {
    await Promise.resolve();
    return `<!doctype html><html><head><title>${this.#brand}</title></head><body>${this.#brand}</body></html>`;
  }

  async readAsset(
    filename: string,
  ): Promise<{ content: string; contentType: string } | AppError> {
    await Promise.resolve();
    // Validate filename same way the real adapter does.
    const validationErr = this.#validateFilename(filename);
    if (validationErr) {
      return validationErr;
    }
    const asset = this.#assets.get(filename);
    if (!asset) {
      return new NotFoundError(`static asset not found: ${filename}`);
    }
    return asset;
  }

  #validateFilename(filename: string): AppError | null {
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
