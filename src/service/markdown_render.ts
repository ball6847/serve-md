import { Marked, type Tokens } from "marked";
import hljs from "highlight.js";
import { trySync } from "../utils/try_sync.ts";
import { Frontmatter } from "../domain/frontmatter.ts";
import { ContentPath } from "../domain/content_path.ts";
import {
  escapeAttr,
  escapeHtml,
  isMarkdownLink,
  slugify,
  unescapeHtml,
} from "../utils/markdown_utils.ts";
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
  frontmatter: Frontmatter | null;
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
          if (lang === "mermaid") {
            // Preserve for client-side mermaid - do NOT escape, mermaid needs raw text
            // Also unescape any HTML entities that might be in the source
            const unescaped = unescapeHtml(code);
            return `<pre class="mermaid">${unescaped}</pre>\n`;
          }
          // Synchronous highlight.js call — use trySync for consistent error handling.
          const [hlErr, highlightedResult] = trySync(() => {
            if (lang && hljs.getLanguage(lang)) {
              return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
          });
          const highlighted = hlErr ? escapeHtml(code) : highlightedResult;
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
    const { frontmatter, body } = Frontmatter.parse(markdown);
    // Pre-construct ContentPath for link/image resolution in renderers below.
    // options.relativeDir is a directory, so append a synthetic filename so
    // ContentPath.directory returns the original dir (dirname("posts/_.md") === "posts").
    const dir = options.relativeDir === "." || options.relativeDir === ""
      ? ""
      : options.relativeDir;
    const contentPath = new ContentPath(dir.length === 0 ? "_.md" : `${dir}/_.md`);

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
          const src = contentPath.rewriteImageSrc(token.href, warnings);
          const titleAttr = token.title ? ` title="${escapeAttr(token.title)}"` : "";
          const altAttr = ` alt="${escapeAttr(token.text)}"`;
          return `<img src="${escapeAttr(src)}"${altAttr}${titleAttr} loading="lazy" />`;
        },
        link(this: unknown, token: Tokens.Link) {
          const href = token.href;
          // Rewrite relative .md/.markdown links to deep links
          if (isMarkdownLink(href) && !href.startsWith("http") && !href.startsWith("/")) {
            const resolved = contentPath.resolveMarkdownLink(href);
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

    // Synchronous marked.parse() call — use trySync for consistent error handling.
    const [parseErr, out] = trySync(() => m2.parse(body, { async: false }));
    if (parseErr) {
      warnings.push(`render error: ${String(parseErr)}`);
      return { html: `<pre>${escapeHtml(body)}</pre>`, toc, warnings, frontmatter };
    }
    const parsedHtml = typeof out === "string" ? out : "";
    return { html: parsedHtml, toc, warnings, frontmatter };
  }
}
