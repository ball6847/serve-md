import { dirname, extname, normalize as posixNormalize } from "@std/path/posix";

const CONTENT_EXTS = new Set([".md", ".markdown", ".html", ".htm"]);
const ALWAYS_EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "vendor",
  "target",
]);

/**
 * Value object: a path relative to the content root.
 *
 * Encapsulates all business rules that operate on a content path:
 * - content-type detection (is this a markdown/HTML file?)
 * - exclusion policy (dot-paths, vendor dirs)
 * - link resolution (markdown deep links, image src rewriting)
 *
 * Immutable — constructed with a relative path, all methods are pure.
 */
export class ContentPath {
  constructor(readonly relativePath: string) {}

  /** Filename including extension (e.g. "readme.md"). */
  get basename(): string {
    const idx = this.relativePath.lastIndexOf("/");
    return idx === -1 ? this.relativePath : this.relativePath.slice(idx + 1);
  }

  /** Extension including the leading dot (e.g. ".md"), empty string if none. */
  get extension(): string {
    return extname(this.relativePath);
  }

  /** Directory portion (posix-style); returns "." for root-level files. */
  get directory(): string {
    return dirname(this.relativePath);
  }

  /** True if this path points to a content file (.md/.markdown/.html/.htm). */
  isContentFile(): boolean {
    return CONTENT_EXTS.has(this.extension.toLowerCase());
  }

  /**
   * True if this path should be excluded from the content index.
   *
   * Rules:
   * - Any path segment starting with `.` is excluded unless its basename is in
   *   `dotWhitelist` (e.g. `.context`).
   * - Any path segment matching an entry in `ALWAYS_EXCLUDE_DIRS` is excluded.
   */
  isExcluded(dotWhitelist: string[]): boolean {
    const parts = this.relativePath.split("/").filter((p) => p.length > 0);
    const wl = new Set(dotWhitelist);
    for (const p of parts) {
      if (p.startsWith(".") && !wl.has(p)) {
        return true;
      }
      if (ALWAYS_EXCLUDE_DIRS.has(p)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resolve a relative markdown link against this path's directory.
   *
   * Returns a path-style deep link URL (e.g. "/docs/other.md#section").
   * The anchor (if present in `href`) is preserved.
   */
  resolveMarkdownLink(href: string): string {
    const [pathPart, anchorPart] = href.split("#", 2);
    const anchor = anchorPart ? `#${anchorPart}` : "";
    const baseDir = this.directory === "." ? "" : this.directory;
    const joined = baseDir.length === 0 ? pathPart : `${baseDir}/${pathPart}`;
    const resolved = posixNormalize(joined).replace(/^\.\//, "");
    return `/${resolved}${anchor}`;
  }

  /**
   * Rewrite a relative image src to a `/content/` route.
   *
   * - `data:` URIs and `http(s)://` URLs are returned unchanged.
   * - Absolute paths starting with `/` are returned unchanged.
   * - Relative paths containing `..` are blocked (returns `"#"` and a warning
   *   is pushed into `warnings`).
   * - All other relative paths are resolved against this path's directory and
   *   prefixed with `/content/`.
   */
  rewriteImageSrc(href: string, warnings: string[]): string {
    if (href.startsWith("data:")) {
      return href;
    }
    if (/^https?:\/\//i.test(href)) {
      return href;
    }
    if (href.startsWith("/")) {
      if (href.startsWith("/content/")) {
        return href;
      }
      return href;
    }
    if (href.includes("..")) {
      warnings.push(`image src contains '..': ${href}`);
      return "#";
    }
    const baseDir = this.directory === "." ? "" : this.directory;
    const joined = baseDir.length === 0 ? href : `${baseDir}/${href}`;
    const resolved = posixNormalize(joined).replace(/^\.\//, "");
    if (resolved.startsWith("../") || resolved === "..") {
      warnings.push(`image src escapes dir: ${href}`);
      return "#";
    }
    return `/content/${resolved}`;
  }
}
