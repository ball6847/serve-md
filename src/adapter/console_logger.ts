import type { Logger, LogLevel } from "../ports/logger.ts";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface ConsoleLoggerOptions {
  level: LogLevel;
  /** Custom sink — defaults to Deno.stdout.writeSync for stdout, Deno.stderr for warn/error. */
  writer?: (line: string) => void;
  /** Override base bindings, e.g. service name. */
  base?: Record<string, unknown>;
}

/**
 * Simple JSON-line logger. Single-process, single-stream-per-level.
 * Never throws — all internal failures are swallowed (logging must not crash
 * the app).
 */
export class ConsoleLogger implements Logger {
  readonly #level: LogLevel;
  readonly #writer: (line: string) => void;
  readonly #base: Record<string, unknown>;

  constructor(options: ConsoleLoggerOptions) {
    this.#level = options.level;
    this.#base = options.base ?? {};
    this.#writer = options.writer ?? defaultWriter;
  }

  debug(bindings: Record<string, unknown>, message: string): void {
    this.#emit("debug", bindings, message);
  }

  info(bindings: Record<string, unknown>, message: string): void {
    this.#emit("info", bindings, message);
  }

  warn(bindings: Record<string, unknown>, message: string): void {
    this.#emit("warn", bindings, message);
  }

  error(bindings: Record<string, unknown>, message: string): void {
    this.#emit("error", bindings, message);
  }

  child(
    bindings: Record<string, unknown>,
    options?: { level?: LogLevel },
  ): Logger {
    return new ConsoleLogger({
      level: options?.level ?? this.#level,
      writer: this.#writer,
      base: { ...this.#base, ...bindings },
    });
  }

  #emit(
    level: LogLevel,
    bindings: Record<string, unknown>,
    message: string,
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.#level]) {
      return;
    }
    const record: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      ...this.#base,
      ...bindings,
      message,
    };
    let line: string;
    try {
      line = JSON.stringify(record) + "\n";
    } catch {
      // e.g. circular structures; fall back to a minimal line
      line = JSON.stringify({
        time: record.time,
        level,
        message,
        bindingsError: "could not serialize",
      }) + "\n";
    }
    try {
      this.#writer(line);
    } catch {
      // last-resort swallow — logging must not crash
    }
  }
}

function defaultWriter(line: string): void {
  const isError = line.includes('"level":"error"') ||
    line.includes('"level":"warn"');
  const encoder = new TextEncoder();
  if (isError) {
    Deno.stderr.writeSync(encoder.encode(line));
  } else {
    Deno.stdout.writeSync(encoder.encode(line));
  }
}
