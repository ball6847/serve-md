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
            // Preserve for client-side mermaid
            return `<pre class="mermaid">${escapeHtml(code)}</pre>\n`;
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
        link() {
          // External/anchor: leave as is. Internal .md? — leave to the reader.
          return false; // false = use default renderer
        },
      },
    });
    void m2;

    let parsedHtml = "";
    try {
      const out = m2.parse(markdown, { async: false });
      parsedHtml = typeof out === "string" ? out : "";
    } catch (e) {
      warnings.push(`render error: ${String(e)}`);
      return { html: `<pre>${escapeHtml(markdown)}</pre>`, toc, warnings };
    }
    return { html: parsedHtml, toc, warnings };
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
