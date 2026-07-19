/**
 * Logger port.
 *
 * App code depends only on this interface. Adapters (console, pino, ...)
 * implement it. Structured logs only; no console.log in app code.
 *
 * Bindings are camelCase (`requestId`, `path`, `errCode`). Never log secrets.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(bindings: Record<string, unknown>, message: string): void;
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
  child(
    bindings: Record<string, unknown>,
    options?: { level?: LogLevel },
  ): Logger;
}
