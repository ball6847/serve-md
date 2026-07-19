/**
 * Sentinel error hierarchy.
 *
 * All app errors are values (not thrown across layer boundaries in normal flow).
 * Services return `[err, data]` tuples from `await-to-js` `to()`; on error they
 * build and return one of these sentinels. The HTTP layer maps `code` → status.
 *
 * Codes are stable, machine-readable SCREAMING_SNAKE_CASE strings.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;

  readonly context: Record<string, unknown> | undefined;
  override readonly cause: unknown;

  constructor(
    message: string,
    options?: { context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message);
    this.name = new.target.name;
    this.context = options?.context;
    this.cause = options?.cause;
  }

  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND";
}

export class PathTraversalError extends AppError {
  readonly code = "PATH_TRAVERSAL";
}

export class ReadFailedError extends AppError {
  readonly code = "READ_FAILED";
}

export class ConfigInvalidError extends AppError {
  readonly code = "CONFIG_INVALID";
}

export class NotReadyError extends AppError {
  readonly code = "NOT_READY";
}

/** Narrow unknown to AppError. */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
