import { join, normalize, relative, SEPARATOR } from "@std/path";
import { to } from "await-to-js";
import { trySync } from "../utils/try_sync.ts";
import { AppError, NotFoundError, PathTraversalError, ReadFailedError } from "../domain/errors.ts";
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
 * appropriate sentinel as a value (not thrown).
 */
export class DenoFileStore implements FileStore {
  readonly contentRoot: string;

  constructor(contentRoot: string) {
    const [err, real] = trySync(() => normalize(Deno.realPathSync(contentRoot)));
    this.contentRoot = err ? normalize(contentRoot) : real;
  }

  resolveRelative(relativePath: string): Promise<string | AppError> {
    return this.#resolve(relativePath);
  }

  async stat(relativePath: string): Promise<FileStat | AppError> {
    const abs = await this.#resolve(relativePath);
    if (abs instanceof AppError) {
      return abs;
    }
    const [err, info] = await to(Deno.stat(abs));
    if (err) {
      return mapDenoStatError(err);
    }
    return {
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      size: info.size,
      mtime: info.mtime,
    };
  }

  async readText(relativePath: string): Promise<string | AppError> {
    const abs = await this.#resolve(relativePath);
    if (abs instanceof AppError) {
      return abs;
    }
    const [err, content] = await to(Deno.readTextFile(abs));
    if (err) {
      if (err instanceof Deno.errors.NotFound) {
        return new NotFoundError(`file not found: ${relativePath}`, { cause: err });
      }
      return new ReadFailedError(`read failed: ${relativePath}`, { cause: err });
    }
    return content;
  }

  async readBytes(relativePath: string): Promise<Uint8Array | AppError> {
    const abs = await this.#resolve(relativePath);
    if (abs instanceof AppError) {
      return abs;
    }
    const [err, content] = await to(Deno.readFile(abs));
    if (err) {
      if (err instanceof Deno.errors.NotFound) {
        return new NotFoundError(`file not found: ${relativePath}`, { cause: err });
      }
      return new ReadFailedError(`read failed: ${relativePath}`, { cause: err });
    }
    return content;
  }

  async listDir(relativePath: string): Promise<DirEntry[] | AppError> {
    const abs = await this.#resolve(relativePath);
    if (abs instanceof AppError) {
      return abs;
    }
    const [err, entries] = await to((async () => {
      const result: Deno.DirEntry[] = [];
      for await (const e of Deno.readDir(abs)) {
        result.push(e);
      }
      return result;
    })());
    if (err) {
      if (err instanceof Deno.errors.NotFound) {
        return new NotFoundError(`dir not found: ${relativePath || "."}`, { cause: err });
      }
      return new ReadFailedError(`listdir failed: ${relativePath}`, { cause: err });
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

  async walkFiles(relativePath?: string): Promise<DirEntry[] | AppError> {
    const start = relativePath ?? "";
    const abs = await this.#resolve(start);
    if (abs instanceof AppError) {
      return abs;
    }
    const out: DirEntry[] = [];
    const stack: string[] = [abs];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      const [err, entries] = await to((async () => {
        const result: Deno.DirEntry[] = [];
        for await (const e of Deno.readDir(current)) {
          result.push(e);
        }
        return result;
      })());
      if (err) {
        if (err instanceof Deno.errors.NotFound) {
          return new NotFoundError(`dir not found: ${start || "."}`, { cause: err });
        }
        return new ReadFailedError(`walk failed: ${start}`, { cause: err });
      }
      for (const e of entries) {
        const entryAbs = join(current, e.name);
        if (e.isDirectory) {
          // Verify real path stays inside root (handles dir symlinks)
          if (e.isSymlink) {
            const real = resolveReal(entryAbs);
            if (!isInside(real, this.contentRoot)) {
              continue;
            }
          }
          stack.push(entryAbs);
        } else if (e.isFile) {
          if (e.isSymlink) {
            const real = resolveReal(entryAbs);
            if (!isInside(real, this.contentRoot)) {
              continue;
            }
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
  async #resolve(relativePath: string): Promise<string | AppError> {
    // Reject empty / null bytes
    if (relativePath.includes("\0")) {
      return new PathTraversalError("path contains null byte");
    }
    // Normalize: strip leading slashes
    const rel = relativePath.replace(/^\/+/, "");
    const candidate = normalize(join(this.contentRoot, rel));
    if (!isInside(candidate, this.contentRoot)) {
      return new PathTraversalError(`path escapes root: ${relativePath}`);
    }
    // Resolve symlinks if path exists; if not, return normalized candidate
    // so the caller gets a clear NotFoundError. Only check symlinks for
    // entries that exist (Deno.stat will tell us).
    const [err, lstat] = await to(Deno.lstat(candidate));
    if (err) {
      if (err instanceof Deno.errors.NotFound) {
        // File doesn't exist yet — return candidate so caller gets NotFoundError
        return candidate;
      }
      return new ReadFailedError(`lstat failed: ${relativePath}`, { cause: err });
    }
    const isSymlink = lstat.isSymlink;
    if (isSymlink) {
      const real = resolveReal(candidate);
      if (!isInside(real, this.contentRoot)) {
        return new PathTraversalError(`symlink escapes root: ${relativePath}`);
      }
      return real;
    }
    return candidate;
  }
}

function resolveReal(p: string): string {
  const [err, real] = trySync(() => normalize(Deno.realPathSync(p)));
  if (err) {
    return normalize(p);
  }
  return real;
}

function isInside(candidate: string, root: string): boolean {
  const c = normalize(candidate);
  const r = normalize(root);
  if (c === r) {
    return true;
  }
  const rel = relative(r, c);
  return !rel.startsWith("..") && !normalize(rel).startsWith("..");
}

function mapDenoStatError(e: unknown): AppError {
  if (e instanceof Deno.errors.NotFound) {
    return new NotFoundError("not found", { cause: e });
  }
  return new ReadFailedError("stat failed", { cause: e });
}
