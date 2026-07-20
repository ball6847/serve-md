/**
 * Generic string and HTML utilities used by the markdown render pipeline.
 *
 * These are pure helpers with no business-domain meaning — they live in utils/
 * rather than domain/ because they don't operate on any domain entity.
 */

/** Heading text → URL-safe ID. Falls back to "section" for empty input. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "section";
}

/** HTML entity encode. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** HTML entity decode. */
export function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Attribute-value encode (delegates to escapeHtml). */
export function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/** Check if a link points to a markdown file (relative, no protocol). */
export function isMarkdownLink(href: string): boolean {
  const withoutHash = href.split("#")[0];
  return withoutHash.endsWith(".md") || withoutHash.endsWith(".markdown");
}

/** Extract the extension from a filename (including the leading dot). */
export function extOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx);
}
