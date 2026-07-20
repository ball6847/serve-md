import type { DirEntry, FileStat, FileStore } from "../ports/file_store.ts";
import { NotFoundError, PathTraversalError } from "../domain/errors.ts";

/**
 * In-memory FileStore fake for tests.
 * - `files` is `{ relativePath: { content, size?, mtime? } }`
 * - `dirs` is the set of directory relative paths that should be recognized
 *   (auto-derived from files if not given).
 */
export class FakeFileStore implements FileStore {
  readonly contentRoot: string;
  readonly #files = new Map<string, { content: Uint8Array; mtime: Date | null }>();
  readonly #dirs = new Set<string>();

  constructor(contentRoot: string) {
    this.contentRoot = contentRoot;
  }

  add(rel: string, content: string | Uint8Array, opts?: { mtime?: Date }): void {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    this.#files.set(rel, { content: bytes, mtime: opts?.mtime ?? null });
    // ensure parent dirs
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) {
      this.#dirs.add(parts.slice(0, i).join("/"));
    }
  }

  addDir(rel: string): void {
    this.#dirs.add(rel);
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) {
      this.#dirs.add(parts.slice(0, i).join("/"));
    }
  }

  resolveRelative(relativePath: string): Promise<string> {
    if (relativePath.includes("..")) {
      return Promise.reject(new PathTraversalError(`path escapes root: ${relativePath}`));
    }
    return Promise.resolve(`${this.contentRoot}/${relativePath}`);
  }

  stat(relativePath: string): Promise<FileStat> {
    const entry = this.#files.get(relativePath);
    if (entry) {
      return Promise.resolve({
        isFile: true,
        isDirectory: false,
        size: entry.content.byteLength,
        mtime: entry.mtime ?? null,
      });
    }
    if (this.#dirs.has(relativePath) || relativePath === "" || relativePath === ".") {
      return Promise.resolve({
        isFile: false,
        isDirectory: true,
        size: 0,
        mtime: null,
      });
    }
    return Promise.reject(new NotFoundError(`not found: ${relativePath}`));
  }

  readText(relativePath: string): Promise<string> {
    const e = this.#files.get(relativePath);
    if (!e) {
      return Promise.reject(new NotFoundError(`not found: ${relativePath}`));
    }
    return Promise.resolve(new TextDecoder().decode(e.content));
  }

  readBytes(relativePath: string): Promise<Uint8Array> {
    const e = this.#files.get(relativePath);
    if (!e) {
      return Promise.reject(new NotFoundError(`not found: ${relativePath}`));
    }
    return Promise.resolve(e.content);
  }

  listDir(relativePath: string): Promise<DirEntry[]> {
    const prefix = relativePath === "" ? "" : relativePath + "/";
    const out: DirEntry[] = [];
    const seen = new Set<string>();
    for (const p of this.#files.keys()) {
      if (!p.startsWith(prefix)) {
        continue;
      }
      const rest = p.slice(prefix.length);
      const first = rest.split("/")[0];
      if (seen.has(first)) {
        continue;
      }
      seen.add(first);
      out.push({
        name: first,
        isFile: !rest.includes("/"),
        isDirectory: rest.includes("/"),
        relativePath: prefix + first,
      });
    }
    for (const d of this.#dirs) {
      if (!d.startsWith(prefix) || d === relativePath) {
        continue;
      }
      const rest = d.slice(prefix.length);
      if (rest.includes("/")) {
        continue; // sub-dir of a sub-dir; not a direct child
      }
      if (seen.has(rest)) {
        continue;
      }
      seen.add(rest);
      out.push({ name: rest, isFile: false, isDirectory: true, relativePath: d });
    }
    return Promise.resolve(out);
  }

  walkFiles(relativePath?: string): Promise<DirEntry[]> {
    const prefix = relativePath && relativePath.length > 0 ? relativePath + "/" : "";
    const out: DirEntry[] = [];
    for (const p of this.#files.keys()) {
      if (!p.startsWith(prefix)) {
        continue;
      }
      out.push({ name: p.slice(prefix.length), isFile: true, isDirectory: false, relativePath: p });
    }
    out.sort((a, b) =>
      a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0
    );
    return Promise.resolve(out);
  }
}
