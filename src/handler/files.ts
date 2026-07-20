import type { ContentFile } from "../domain/content_file.ts";
import { Frontmatter } from "../domain/frontmatter.ts";
import { MarkdownRenderService } from "../service/markdown_render.ts";
import type { ContentIndexService } from "../service/content_index.ts";
import type { FileStore } from "../ports/file_store.ts";
import type { Logger } from "../ports/logger.ts";
import { NotFoundError, ReadFailedError } from "../domain/errors.ts";
import { to } from "await-to-js";
import * as posix from "@std/path/posix";

/**
 * HTTP layer for file operations. Per plan 06:
 *
 *   GET /api/files             → { data: ContentFile[] }
 *   GET /api/tree              → { data: ContentTreeNode }
 *   GET /api/default-file      → { data: { path: string | null } }
 *   GET /api/file/<rel>        → { data: { ...meta, largeFile, kind } }
 *   GET /content/<rel>         → raw bytes (path-traversal-safe)
 */
export const LARGE_FILE_BYTES = 2 * 1024 * 1024; // 2MB

export interface FilesHandlerDeps {
  index: ContentIndexService;
  store: FileStore;
  logger: Logger;
  /** Optional render service. If absent, markdown responses omit html/toc. */
  renderer?: MarkdownRenderService;
}

export class FilesHandler {
  readonly #deps: FilesHandlerDeps;
  constructor(deps: FilesHandlerDeps) {
    this.#deps = deps;
  }

  listFiles(): Response {
    const files: ContentFile[] = this.#deps.index.listFiles();
    return Response.json({ data: files });
  }

  tree(): Response {
    return Response.json({ data: this.#deps.index.getTree() });
  }

  async defaultFile(): Promise<Response> {
    const path = await this.#deps.index.resolveDefaultOpen();
    return Response.json({ data: { path } });
  }

  async fileMeta(path: string): Promise<Response> {
    // Enforce path safety up front. The store rejects any traversal attempt.
    await this.#deps.store.resolveRelative(path);

    // Allow extensionless README as a special case
    const known = this.#deps.index.getFile(path);
    if (!known) {
      if (path === "README") {
        // Try to stat directly; treat as plain
        const [statErr, stat] = await to(this.#deps.store.stat("README"));
        if (statErr || !stat?.isFile) {
          throw new NotFoundError(`file not found: ${path}`, { cause: statErr ?? undefined });
        }
        const text = await this.#deps.store.readText("README");
        const rendered = this.#deps.renderer?.render(text, { relativeDir: "" });
        return Response.json({
          data: {
            relativePath: "README",
            basename: "README",
            kind: "plain",
            size: stat.size,
            mtime: stat.mtime,
            largeFile: stat.size > LARGE_FILE_BYTES,
            contentType: "text/plain",
            text,
            html: rendered?.html ?? null,
            toc: rendered?.toc ?? null,
            warnings: rendered?.warnings ?? null,
          },
        });
      }
      throw new NotFoundError(`file not found: ${path}`);
    }
    const stat = await this.#deps.store.stat(known.relativePath);
    const contentType = contentTypeFor(known.basename);
    const isMarkdown = known.kind === "markdown";
    const isHtml = known.kind === "html";
    const relativeDir = posix.dirname(known.relativePath) === "."
      ? ""
      : posix.dirname(known.relativePath);

    // For markdown: read text and render (if renderer present)
    let text: string | null = null;
    let html: string | null = null;
    let toc: ReturnType<MarkdownRenderService["render"]>["toc"] | null = null;
    let warnings: string[] | null = null;
    let frontmatter: Frontmatter | null = null;

    if (isMarkdown) {
      if (largeFile(stat.size)) {
        // For large markdown, still include the raw text but skip render to avoid blocking
        const [readErr, t] = await to(this.#deps.store.readText(known.relativePath));
        if (readErr) {
          throw new NotFoundError("failed to read", { cause: readErr });
        }
        text = t;
      } else if (this.#deps.renderer) {
        const [readErr, t] = await to(this.#deps.store.readText(known.relativePath));
        if (readErr) {
          throw new NotFoundError("failed to read", { cause: readErr });
        }
        text = t;
        const result = this.#deps.renderer.render(t, { relativeDir });
        html = result.html;
        toc = result.toc;
        warnings = result.warnings;
        frontmatter = result.frontmatter ?? null;
      }
    } else if (isHtml) {
      // Don't inline HTML body; UI will load via iframe /content/<path>
    }

    return Response.json({
      data: {
        relativePath: known.relativePath,
        basename: known.basename,
        kind: known.kind,
        size: stat.size,
        mtime: stat.mtime,
        largeFile: stat.size > LARGE_FILE_BYTES,
        contentType,
        text,
        html,
        toc,
        warnings,
        frontmatter: frontmatter?.toJSON() ?? null,
      },
    });
  }

  async rawContent(path: string): Promise<Response> {
    // Allow ANY file under root for assets (HTML needs relative assets like images/css/js).
    // Path traversal is enforced by FileStore.resolveRelative + isInside check.
    const abs = await this.#deps.store.resolveRelative(path);
    const [statErr, stat] = await to(this.#deps.store.stat(path));
    if (statErr || !stat?.isFile) {
      throw new NotFoundError(`file not found: ${path}`, { cause: statErr ?? undefined });
    }
    const bytes = await this.#deps.store.readBytes(path);
    const contentType = contentTypeFor(path);
    void abs;
    // Cast to BodyInit: Uint8Array is accepted at runtime; the DOM lib here
    // is conservative. The constructor accepts BufferSource.
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(stat.size),
        "cache-control": "no-cache",
      },
    });
  }
}

export function contentTypeFor(pathOrName: string): string {
  const name = pathOrName.split("/").pop() ?? pathOrName;
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "text/markdown; charset=utf-8";
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "text/html; charset=utf-8";
  }
  if (lower.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) {
    return "application/javascript; charset=utf-8";
  }
  if (lower.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".ico")) {
    return "image/x-icon";
  }
  if (lower.endsWith(".txt")) {
    return "text/plain; charset=utf-8";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  // Plain / unknown
  return "application/octet-stream";
}

// Re-export ReadFailedError for callers constructing AppError responses.
export { ReadFailedError };

function largeFile(size: number): boolean {
  return size > LARGE_FILE_BYTES;
}
