/**
 * StaticAssetStore port.
 *
 * Serves static UI assets (HTML, CSS, JS) from the bundled `src/ui/` directory.
 * The default implementation is `DenoStaticAssetStore`, but tests can
 * substitute fakes.
 *
 * Errors:
 * - Missing files → `NotFoundError`
 * - Invalid filename (path traversal, wrong extension) → `PathTraversalError`
 *
 * AGENTS: all methods return `T | AppError` — errors are values, not thrown.
 * Callers must check `instanceof AppError` on the result.
 */
import { AppError } from "../domain/errors.ts";
export interface StaticAssetStore {
  /**
   * Read index.html content for the root route.
   * The implementation handles any template substitution (e.g. brand).
   * Returns `NotFoundError` as a value if index.html is missing.
   */
  readIndex(): Promise<string | AppError>;

  /**
   * Read a static asset by filename (CSS or JS only).
   * Validates the filename before reading — rejects path traversal attempts.
   * Returns `NotFoundError` or `PathTraversalError` as a value on failure.
   */
  readAsset(
    filename: string,
  ): Promise<{ content: string; contentType: string } | AppError>;
}
