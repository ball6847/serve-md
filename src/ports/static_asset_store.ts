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
 */
export interface StaticAssetStore {
  /**
   * Read index.html content for the root route.
   * The implementation handles any template substitution (e.g. brand).
   */
  readIndex(): Promise<string>;

  /**
   * Read a static asset by filename (CSS or JS only).
   * Validates the filename before reading — rejects path traversal attempts.
   */
  readAsset(
    filename: string,
  ): Promise<{ content: string; contentType: string }>;
}
