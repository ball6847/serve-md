import { Marked, type Tokens } from "marked";
import hljs from "highlight.js";
import { normalize as posixNormalize } from "@std/path/posix";
export interface TocEntry {
  id: string;
  text: string;
  level: number; // 1-6
}

export interface RenderOptions {
  /** Directory of the markdown file, posix-style relative to content root. */
  relativeDir: string;
}

export interface RenderResult {
  /** HTML fragment (no doctype, no body). */
  html: string;
  toc: TocEntry[];
  /** Non-fatal warnings collected during render. */
  warnings: string[];
  /** Parsed YAML frontmatter metadata (if present). */
  frontmatter: Record<string, unknown> | null;
}

/**
 * MarkdownRenderService — best-effort Markdown → HTML for the reader.
 *
 * Features:
 * - GFM tables, strikethrough, autolinks (via marked's GFM extension).
 * - Syntax highlighting via highlight.js.
 * - Heading anchors + id attributes.
 * - TOC entries extracted during render.
 * - Relative image `src` rewritten to `/content/<relativeDir>/<path>`.
 * - Mermaid fences preserved for client-side rendering (class="mermaid").
 * - Malformed markdown never throws — best-effort HTML returned.
 */
export class MarkdownRenderService {
  readonly #marked: Marked;

  constructor() {
    const m = new Marked({
      gfm: true,
      breaks: false,
    });

    // Highlight.js for code blocks
    m.use({
      renderer: {
        code(this: unknown, token: Tokens.Code) {
          const code = token.text;
          const lang = (token.lang || "").trim().split(/\s+/)[0] ?? "";
          let highlighted: string;
          if (lang === "mermaid") {
            // Preserve for client-side mermaid - do NOT escape, mermaid needs raw text
            // Also unescape any HTML entities that might be in the source
            const unescaped = unescapeHtml(code);
            return `<pre class="mermaid">${unescaped}</pre>\n`;
          }
          try {
            if (lang && hljs.getLanguage(lang)) {
              highlighted = hljs.highlight(code, { language: lang }).value;
            } else {
              highlighted = hljs.highlightAuto(code).value;
            }
          } catch {
            highlighted = escapeHtml(code);
          }
          const langClass = lang ? ` class="language-${escapeAttr(lang)}"` : "";
          return `<pre><code${langClass}>${highlighted}</code></pre>\n`;
        },
      },
    });
    this.#marked = m;
  }

  render(markdown: string, options: RenderOptions): RenderResult {
    const warnings: string[] = [];
    const toc: TocEntry[] = [];
    const seenIds = new Set<string>();

    // Parse frontmatter
    const { frontmatter, body } = parseFrontmatter(markdown);

    // heading IDs
    const m2 = this.#marked.use({
      renderer: {
        heading(this: unknown, token: Tokens.Heading) {
          const text = token.text;
          const level = token.depth;
          const rawId = slugify(text);
          let id = rawId;
          let n = 2;
          while (seenIds.has(id)) {
            id = `${rawId}-${n++}`;
          }
          seenIds.add(id);
          toc.push({ id, text, level });
          const inner = (this as unknown as {
            parser: { parseInline: (t: Tokens.Generic[]) => string };
          }).parser.parseInline(token.tokens as unknown as Tokens.Generic[]);
          return `<h${level} id="${escapeAttr(id)}">${inner} <a class="anchor" href="#${
            escapeAttr(id)
          }" aria-hidden="true">#</a></h${level}>\n`;
        },
        image(this: unknown, token: Tokens.Image) {
          const src = rewriteImageSrc(token.href, options.relativeDir, warnings);
          const titleAttr = token.title ? ` title="${escapeAttr(token.title)}"` : "";
          const altAttr = ` alt="${escapeAttr(token.text)}"`;
          return `<img src="${escapeAttr(src)}"${altAttr}${titleAttr} loading="lazy" />`;
        },
        link(this: unknown, token: Tokens.Link) {
          const href = token.href;
          // Rewrite relative .md/.markdown links to deep links
          if (isMarkdownLink(href) && !href.startsWith("http") && !href.startsWith("/")) {
            const resolved = resolveMarkdownLink(href, options.relativeDir);
            const titleAttr = token.title ? ` title="${escapeAttr(token.title)}"` : "";
            const inner = (this as unknown as {
              parser: { parseInline: (t: Tokens.Generic[]) => string };
            }).parser.parseInline(token.tokens as unknown as Tokens.Generic[]);
            // resolveMarkdownLink already returns a leading /, so use it directly
            return `<a href="${escapeAttr(resolved)}"${titleAttr}>${inner}</a>`;
          }
          return false; // default for external links
        },
      },
    });
    void m2;

    let parsedHtml = "";
    try {
      const out = m2.parse(body, { async: false });
      parsedHtml = typeof out === "string" ? out : "";
    } catch (e) {
      warnings.push(`render error: ${String(e)}`);
      return { html: `<pre>${escapeHtml(body)}</pre>`, toc, warnings, frontmatter };
    }
    return { html: parsedHtml, toc, warnings, frontmatter };
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "section";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function rewriteImageSrc(
  href: string,
  relativeDir: string,
  warnings: string[],
): string {
  // Skip data: URIs, absolute http(s), absolute paths starting with /
  if (href.startsWith("data:")) return href;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) {
    // Strip the leading slash — under /content/ we own the route
    if (href.startsWith("/content/")) return href;
    return href; // pass through (browser will resolve against server origin)
  }
  // Relative URL: resolve against the markdown's directory
  // Strip any traversal attempts
  if (href.includes("..")) {
    warnings.push(`image src contains '..': ${href}`);
    return "#";
  }
  const baseDir = relativeDir === "" || relativeDir === "." ? "" : relativeDir;
  const joined = baseDir.length === 0 ? href : `${baseDir}/${href}`;
  // Normalize, then strip leading "./" artifacts
  const resolved = posixNormalize(joined).replace(/^\.\//, "");
  // Defense in depth: after normalize, ensure still no leading ../
  if (resolved.startsWith("../") || resolved === "..") {
    warnings.push(`image src escapes dir: ${href}`);
    return "#";
  }
  return `/content/${resolved}`;
}

/** Check if a link points to a markdown file (relative, no protocol). */
function isMarkdownLink(href: string): boolean {
  const withoutHash = href.split("#")[0];
  return withoutHash.endsWith(".md") || withoutHash.endsWith(".markdown");
}

/** Resolve a relative markdown link against the current file's directory. */
export function resolveMarkdownLink(href: string, relativeDir: string): string {
  // Split off anchor
  const [pathPart, anchorPart] = href.split("#", 2);
  const anchor = anchorPart ? `#${anchorPart}` : "";

  const baseDir = relativeDir === "" || relativeDir === "." ? "" : relativeDir;
  const joined = baseDir.length === 0 ? pathPart : `${baseDir}/${pathPart}`;
  const resolved = posixNormalize(joined).replace(/^\.\//, "");

  // Build path-style deep link URL: /<resolved-path>#anchor
  return `/${resolved}${anchor}`;
}

/**
 * Parse YAML frontmatter from markdown.
 * Returns the parsed metadata and the body with frontmatter removed.
 * Uses a simple key: value parser — sufficient for common metadata fields.
 */
export function parseFrontmatter(markdown: string): {
  frontmatter: Record<string, unknown> | null;
  body: string;
} {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return { frontmatter: null, body: markdown };
  }

  const yamlStr = match[1];
  const body = markdown.slice(match[0].length);
  const data: Record<string, unknown> = {};

  for (const line of yamlStr.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Remove quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Parse arrays: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
      continue;
    }
    // Parse booleans
    if (value === "true") {
      data[key] = true;
      continue;
    }
    if (value === "false") {
      data[key] = false;
      continue;
    }
    // Parse numbers
    if (/^\d+(\.\d+)?$/.test(value)) {
      data[key] = Number(value);
      continue;
    }
    if (value) data[key] = value;
  }

  if (Object.keys(data).length === 0) {
    return { frontmatter: null, body: markdown };
  }
  return { frontmatter: data, body };
}
