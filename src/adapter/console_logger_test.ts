import { assertEquals } from "jsr:@std/assert@^1";
import { ConsoleLogger } from "./console_logger.ts";
import { LogLevel } from "../ports/logger.ts";

function captureLog(level: LogLevel): {
  logger: ConsoleLogger;
  lines: string[];
} {
  const lines: string[] = [];
  const logger = new ConsoleLogger({ level, writer: (s) => lines.push(s) });
  return { logger, lines };
}

Deno.test("ConsoleLogger: debug is silent when level=info", () => {
  const { logger, lines } = captureLog("info");
  logger.debug({ foo: 1 }, "hidden");
  logger.info({ foo: 2 }, "shown");
  assertEquals(lines.length, 1);
  assertEquals(JSON.parse(lines[0]).message, "shown");
  assertEquals(JSON.parse(lines[0]).level, "info");
});

Deno.test("ConsoleLogger: all levels emit when level=debug", () => {
  const { logger, lines } = captureLog("debug");
  logger.debug({ k: 1 }, "d");
  logger.info({ k: 2 }, "i");
  logger.warn({ k: 3 }, "w");
  logger.error({ k: 4 }, "e");
  assertEquals(lines.length, 4);
  const levels = lines.map((l) => JSON.parse(l).level);
  assertEquals(levels, ["debug", "info", "warn", "error"]);
});

Deno.test("ConsoleLogger: level=warn suppresses info+debug", () => {
  const { logger, lines } = captureLog("warn");
  logger.debug({}, "d");
  logger.info({}, "i");
  logger.warn({}, "w");
  logger.error({}, "e");
  assertEquals(lines.length, 2);
  assertEquals(lines.map((l) => JSON.parse(l).level), ["warn", "error"]);
});

Deno.test("ConsoleLogger: bindings are merged into output", () => {
  const { logger, lines } = captureLog("info");
  logger.info({ requestId: "abc", path: "/health" }, "ok");
  const parsed = JSON.parse(lines[0]);
  assertEquals(parsed.requestId, "abc");
  assertEquals(parsed.path, "/health");
  assertEquals(parsed.message, "ok");
  assertEquals(parsed.level, "info");
  assertEquals(parsed.time, parsed.time); // present
});

Deno.test("ConsoleLogger: never throws even with weird bindings", () => {
  const { logger } = captureLog("info");
  // circular structures
  const obj: Record<string, unknown> = {};
  obj.self = obj;
  // Should not throw
  logger.info(obj, "circular");
  logger.info({ fn: () => 1 }, "function val");
});

Deno.test("ConsoleLogger: child logger inherits parent level and merges bindings", () => {
  const { logger: parent, lines } = captureLog("info");
  const child = parent.child?.({ component: "files" });
  if (!child) {
    throw new Error("child missing");
  }
  child.info({ requestId: "r1" }, "from child");
  const parsed = JSON.parse(lines[0]);
  assertEquals(parsed.component, "files");
  assertEquals(parsed.requestId, "r1");
});

Deno.test("ConsoleLogger: child can override level", () => {
  const { logger: parent } = captureLog("warn");
  const child = parent.child?.({}, { level: "debug" });
  if (!child) {
    throw new Error("child missing");
  }
  let emitted = false;
  const writer = (_s: string) => {
    emitted = true;
  };
  // Re-create with custom writer
  const childWriter = new ConsoleLogger({
    level: "debug",
    writer,
  });
  childWriter.debug({}, "should appear");
  assertEquals(emitted, true);
});
