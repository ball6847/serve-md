/**
 * Humanize helpers.
 *
 * Rules (per plan 04 / PRD):
 * - Strip extension.
 * - Replace `-` and `_` with spaces.
 * - Collapse repeated spaces.
 * - Title-case each word for the basename.
 * - The label is `parentPosix › Humanized` (or just the humanized basename at root).
 *   Path segments are kept as-is (no humanization on parent).
 */

const CONTENT_EXT_RE = /\.(md|markdown|html|htm)$/i;

export function humanizeBasename(filename: string): string {
  const base = filename.replace(CONTENT_EXT_RE, "");
  const spaced = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (spaced.length === 0) return base;
  return spaced
    .split(" ")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/**
 * Format the humanized label for a relative path.
 * Examples:
 *   "my-plan.md"               -> "My Plan"
 *   "docs/plans/my-plan.md"    -> "docs/plans › My Plan"
 *   "README.md"                -> "Readme"   (PRD uses exact "README" if matches
 *                                              default-open check; otherwise this
 *                                              title-cases; default-open logic
 *                                              is in service, not here)
 */
export function formatLabel(relativePath: string): string {
  const posix = relativePath.replaceAll("\\", "/");
  const idx = posix.lastIndexOf("/");
  const parent = idx === -1 ? "" : posix.slice(0, idx);
  const filename = idx === -1 ? posix : posix.slice(idx + 1);
  const humanized = humanizeBasename(filename);
  if (parent.length === 0) return humanized;
  return `${parent} › ${humanized}`;
}

/**
 * Infer content kind from filename.
 * Extensionless files (e.g. `README`) are `plain` — used only for default-open
 * (which is a special case in the index service, not for navigation lists).
 */
export function inferKind(filename: string): "markdown" | "html" | "plain" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return "plain";
}
