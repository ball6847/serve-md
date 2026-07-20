/**
 * FileStore port.
 *
 * All content operations go through this interface. The default implementation
 * is `DenoFileStore`, but tests can substitute fakes.
 *
 * Path semantics:
 * - Methods take a **relative path** (posix-style, e.g. `docs/sub/x.md`).
 * - The adapter enforces resolution stays inside `contentRoot`; otherwise it
 *   rejects with `PathTraversalError`.
 * - `..` and absolute paths outside root are always rejected.
 * - Symlinks are followed only if the resolved real path stays inside root.
 *
 * Errors:
 * - Missing files → `NotFoundError`
 * - Path escapes / symlink escapes → `PathTraversalError`
 * - Other I/O failures (permissions, non-utf8 text read) → `ReadFailedError`
 *
 * AGENTS: all methods return `T | AppError` — errors are values, not thrown.
 * Callers must check `instanceof AppError` on the result.
 */
import { AppError } from "../domain/errors.ts";
export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtime: Date | null;
}

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  /** Path relative to content root, posix-style. */
  relativePath: string;
}

export interface FileStore {
  readonly contentRoot: string;
  resolveRelative(relativePath: string): Promise<string | AppError>;
  stat(relativePath: string): Promise<FileStat | AppError>;
  readText(relativePath: string): Promise<string | AppError>;
  readBytes(relativePath: string): Promise<Uint8Array | AppError>;
  listDir(relativePath: string): Promise<DirEntry[] | AppError>;
  /** Recursive file entries (no directories) with posix-style relative paths. */
  walkFiles(relativePath?: string): Promise<DirEntry[] | AppError>;
}
