import { to } from "await-to-js";
import * as posix from "@std/path/posix";
import type { ContentFile, ContentTreeNode } from "../domain/content_file.ts";
import type { DirEntry, FileStore } from "../ports/file_store.ts";
import { NotFoundError, ReadFailedError } from "../domain/errors.ts";
import { ContentPath } from "../domain/content_path.ts";

/**
 * In-memory content-only index over a FileStore.
 *
 * Behavior:
 * - Only files with extensions `.md`, `.html`, `.htm` (case-insensitive) are
 *   included in `listFiles()` / `getTree()`.
 * - Path segments starting with `.` are excluded unless the segment basename
 *   is in `dotWhitelist` (e.g. `.context`).
 * - Always-excluded directory basenames: `node_modules`, `dist`, `build`,
 *   `vendor`, `target`.
 * - Bare `README` (extensionless) is **not** in `listFiles()` but is returned
 *   from `resolveDefaultOpen()` if present on disk.
 * - `refresh()` rebuilds; on failure, the previous index is kept and the
 *   sentinel error is returned to the caller.
 */
export interface ContentIndexOptions {
  dotWhitelist: string[];
}

export class ContentIndexService {
  readonly #store: FileStore;
  readonly #opts: ContentIndexOptions;
  #files: ContentFile[] = [];
  #byPath: Map<string, ContentFile> = new Map();
  #tree: ContentTreeNode = { name: "", relativePath: "", type: "dir", children: [] };
  #lastError: ReadFailedError | null = null;

  constructor(store: FileStore, options: ContentIndexOptions) {
    this.#store = store;
    this.#opts = options;
  }

  /** Rebuild the in-memory index. Returns error sentinel on failure. */
  async refresh(): Promise<ReadFailedError | null> {
    const [err, entries] = await to(this.#store.walkFiles(""));
    if (err) {
      const readErr = err instanceof ReadFailedError || err instanceof NotFoundError
        ? new ReadFailedError("index refresh failed", { cause: err })
        : new ReadFailedError("index refresh failed", { cause: err });
      this.#lastError = readErr;
      // Per plan: keep previous index, surface error to caller
      return readErr;
    }
    this.#lastError = null;
    await this.#rebuild(entries);
    return null;
  }

  async #rebuild(entries: DirEntry[]): Promise<void> {
    const files: ContentFile[] = [];
    for (const e of entries) {
      const path = new ContentPath(e.relativePath);
      if (!path.isContentFile()) {
        continue;
      }
      if (path.isExcluded(this.#opts.dotWhitelist)) {
        continue;
      }
      const kind =
        path.extension.toLowerCase() === ".html" || path.extension.toLowerCase() === ".htm"
          ? "html"
          : "markdown";
      files.push({
        relativePath: e.relativePath,
        basename: path.basename,
        kind,
        size: 0,
        mtime: null,
      });
    }
    files.sort((
      a,
      b,
    ) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
    // Hydrate stat for size/mtime before publishing the index so listFiles()
    // returns fully populated ContentFile objects.
    await this.#hydrateStats(files);
    this.#files = files;
    this.#byPath = new Map(files.map((f) => [f.relativePath, f]));
    this.#tree = this.#buildTree(files);
  }

  async #hydrateStats(files: ContentFile[]): Promise<void> {
    for (const f of files) {
      const [err, stat] = await to(this.#store.stat(f.relativePath));
      if (err) {
        continue;
      }
      f.size = stat.size;
      f.mtime = stat.mtime;
    }
  }

  listFiles(): ContentFile[] {
    return this.#files;
  }

  getTree(): ContentTreeNode {
    return this.#tree;
  }

  getFile(relativePath: string): ContentFile | undefined {
    return this.#byPath.get(relativePath);
  }

  lastError(): ReadFailedError | null {
    return this.#lastError;
  }

  /**
   * Resolve the default-open path per PRD authoritative order:
   * 1. `README.md`
   * 2. `readme.md`
   * 3. `README` (extensionless, may not be in filtered index)
   * 4. `null` if none
   *
   * The extensionless `README` is checked on disk directly via the store so
   * it works even when the index excludes it.
   */
  async resolveDefaultOpen(): Promise<string | null> {
    // 1) README.md
    if (this.#byPath.has("README.md")) {
      return "README.md";
    }
    // 2) readme.md
    if (this.#byPath.has("readme.md")) {
      return "readme.md";
    }
    // 3) README (extensionless) — must be a regular file at root
    const [err, stat] = await to(this.#store.stat("README"));
    if (!err && stat?.isFile) {
      return "README";
    }
    return null;
  }

  #buildTree(files: ContentFile[]): ContentTreeNode {
    const root: ContentTreeNode = {
      name: "",
      relativePath: "",
      type: "dir",
      children: [],
    };
    // Map<dirRelativePath, ContentTreeNode>
    const dirMap = new Map<string, ContentTreeNode>([["", root]]);
    // First create directories that contain files
    for (const f of files) {
      const dir = posix.dirname(f.relativePath);
      const segments = dir === "." ? [] : dir.split("/");
      let acc = "";
      for (const seg of segments) {
        const parent = acc;
        acc = acc.length === 0 ? seg : `${acc}/${seg}`;
        if (!dirMap.has(acc)) {
          const node: ContentTreeNode = {
            name: seg,
            relativePath: acc,
            type: "dir",
            children: [],
          };
          dirMap.set(acc, node);
          const parentNode = dirMap.get(parent) ?? root;
          (parentNode.children as ContentTreeNode[]).push(node);
        }
      }
    }
    // Now add files
    for (const f of files) {
      const dir = posix.dirname(f.relativePath);
      const parent = dir === "." ? root : dirMap.get(dir);
      if (!parent) {
        continue;
      }
      const fileNode: ContentTreeNode = {
        name: f.basename,
        relativePath: f.relativePath,
        type: "file",
        kind: f.kind,
      };
      (parent.children as ContentTreeNode[]).push(fileNode);
    }
    // Sort: dirs first then files, both alphabetical
    for (const node of dirMap.values()) {
      if (!node.children) {
        continue;
      }
      node.children.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "dir" ? -1 : 1;
        }
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
    }
    return root;
  }
}
