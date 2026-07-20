import { join, normalize, relative, SEPARATOR } from "@std/path";
import { NotFoundError, PathTraversalError, ReadFailedError } from "../domain/errors.ts";
import type { DirEntry, FileStat, FileStore } from "../ports/file_store.ts";

function toPosix(p: string): string {
  // Normalize backslashes to forward slashes for cross-platform consistency.
  return SEPARATOR === "/" ? p : p.split(SEPARATOR).join("/");
}

/**
 * Deno-backed FileStore.
 *
 * - `contentRoot` is resolved to an absolute real path at construction.
 * - User paths are treated as **relative to content root** and may not escape it.
 * - Symlinks are followed only if the real path stays inside root.
 *
 * AGENTS: no try/catch — we map Deno errors to `AppError` subclasses via
 * explicit checks (`instanceof Deno.errors.NotFound`, etc.) and return the
 * appropriate sentinel.
 */
export class DenoFileStore implements FileStore {
  readonly contentRoot: string;

  constructor(contentRoot: string) {
    this.contentRoot = normalize(resolveReal(contentRoot));
  }

  resolveRelative(relativePath: string): Promise<string> {
    return this.#resolve(relativePath);
  }

  async stat(relativePath: string): Promise<FileStat> {
    const abs = await this.#resolve(relativePath);
    let info: Deno.FileInfo;
    try {
      info = await Deno.stat(abs);
    } catch (e) {
      throw mapDenoStatError(e);
    }
    return {
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      size: info.size,
      mtime: info.mtime,
    };
  }

  async readText(relativePath: string): Promise<string> {
    const abs = await this.#resolve(relativePath);
    try {
      return await Deno.readTextFile(abs);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new NotFoundError(`file not found: ${relativePath}`, { cause: e });
      }
      throw new ReadFailedError(`read failed: ${relativePath}`, { cause: e });
    }
  }

  async readBytes(relativePath: string): Promise<Uint8Array> {
    const abs = await this.#resolve(relativePath);
    try {
      return await Deno.readFile(abs);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new NotFoundError(`file not found: ${relativePath}`, { cause: e });
      }
      throw new ReadFailedError(`read failed: ${relativePath}`, { cause: e });
    }
  }

  async listDir(relativePath: string): Promise<DirEntry[]> {
    const abs = await this.#resolve(relativePath);
    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (const e of Deno.readDir(abs)) {
        entries.push(e);
      }
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new NotFoundError(`dir not found: ${relativePath || "."}`, { cause: e });
      }
      throw new ReadFailedError(`listdir failed: ${relativePath}`, { cause: e });
    }
    const out: DirEntry[] = [];
    for (const e of entries) {
      const entryAbs = join(abs, e.name);
      // Symlink entries: verify still inside root
      if (e.isSymlink) {
        const real = resolveReal(entryAbs);
        if (!isInside(real, this.contentRoot)) {
          continue;
        }
      }
      out.push({
        name: e.name,
        isFile: e.isFile,
        isDirectory: e.isDirectory,
        relativePath: toPosix(relative(this.contentRoot, entryAbs)),
      });
    }
    return out;
  }

  async walkFiles(relativePath?: string): Promise<DirEntry[]> {
    const start = relativePath ?? "";
    const abs = await this.#resolve(start);
    const out: DirEntry[] = [];
    const stack: string[] = [abs];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      let entries: Deno.DirEntry[];
      try {
        entries = [];
        for await (const e of Deno.readDir(current)) {
          entries.push(e);
        }
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          throw new NotFoundError(`dir not found: ${start || "."}`, { cause: e });
        }
        throw new ReadFailedError(`walk failed: ${start}`, { cause: e });
      }
      for (const e of entries) {
        const entryAbs = join(current, e.name);
        if (e.isDirectory) {
          // Verify real path stays inside root (handles dir symlinks)
          if (e.isSymlink) {
            const real = resolveReal(entryAbs);
            if (!isInside(real, this.contentRoot)) continue;
          }
          stack.push(entryAbs);
        } else if (e.isFile) {
          if (e.isSymlink) {
            const real = resolveReal(entryAbs);
            if (!isInside(real, this.contentRoot)) continue;
          }
          out.push({
            name: e.name,
            isFile: true,
            isDirectory: false,
            relativePath: toPosix(relative(this.contentRoot, entryAbs)),
          });
        }
      }
    }
    out.sort((
      a,
      b,
    ) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
    return out;
  }

  /**
   * Resolve a relative path under root, normalizing, and rejecting any
   * traversal (including symlink escape).
   */
  async #resolve(relativePath: string): Promise<string> {
    // Reject empty / null bytes
    if (relativePath.includes("\0")) {
      throw new PathTraversalError("path contains null byte");
    }
    // Normalize: strip leading slashes
    const rel = relativePath.replace(/^\/+/, "");
    const candidate = normalize(join(this.contentRoot, rel));
    if (!isInside(candidate, this.contentRoot)) {
      throw new PathTraversalError(`path escapes root: ${relativePath}`);
    }
    // Resolve symlinks if path exists; if not, return normalized candidate
    // so the caller gets a clear NotFoundError. Only check symlinks for
    // entries that exist (Deno.stat will tell us).
    let isSymlink = false;
    try {
      const lstat = await Deno.lstat(candidate);
      isSymlink = lstat.isSymlink;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) {
        throw new ReadFailedError(`lstat failed: ${relativePath}`, { cause: e });
      }
    }
    if (isSymlink) {
      const real = resolveReal(candidate);
      if (!isInside(real, this.contentRoot)) {
        throw new PathTraversalError(`symlink escapes root: ${relativePath}`);
      }
      return real;
    }
    return candidate;
  }
}

function resolveReal(p: string): string {
  try {
    return normalize(Deno.realPathSync(p));
  } catch {
    return normalize(p);
  }
}

function isInside(candidate: string, root: string): boolean {
  const c = normalize(candidate);
  const r = normalize(root);
  if (c === r) return true;
  const rel = relative(r, c);
  return !rel.startsWith("..") && !normalize(rel).startsWith("..");
}

function mapDenoStatError(e: unknown): Error {
  if (e instanceof Deno.errors.NotFound) {
    return new NotFoundError("not found", { cause: e });
  }
  return new ReadFailedError("stat failed", { cause: e });
}
