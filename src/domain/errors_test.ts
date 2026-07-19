import { assertEquals, assertInstanceOf, assertStringIncludes } from "jsr:@std/assert@^1";
import {
  AppError,
  ConfigInvalidError,
  isAppError,
  NotFoundError,
  NotReadyError,
  PathTraversalError,
  ReadFailedError,
} from "./errors.ts";

Deno.test("AppError: NotFoundError has stable code and message", () => {
  const err = new NotFoundError("file not found");
  assertInstanceOf(err, AppError);
  assertInstanceOf(err, Error);
  assertEquals(err.code, "NOT_FOUND");
  assertEquals(err.message, "file not found");
  assertEquals(err.name, "NotFoundError");
});

Deno.test("AppError: PathTraversalError stable code", () => {
  const err = new PathTraversalError("escape attempt");
  assertEquals(err.code, "PATH_TRAVERSAL");
  assertInstanceOf(err, AppError);
});

Deno.test("AppError: ReadFailedError stable code", () => {
  const err = new ReadFailedError("disk error");
  assertEquals(err.code, "READ_FAILED");
  assertInstanceOf(err, AppError);
});

Deno.test("AppError: ConfigInvalidError stable code", () => {
  const err = new ConfigInvalidError("bad port");
  assertEquals(err.code, "CONFIG_INVALID");
  assertInstanceOf(err, AppError);
});

Deno.test("AppError: NotReadyError stable code", () => {
  const err = new NotReadyError("content root missing");
  assertEquals(err.code, "NOT_READY");
  assertInstanceOf(err, AppError);
});

Deno.test("AppError: optional context is preserved", () => {
  const err = new NotFoundError("missing", { context: { path: "docs/x.md" } });
  assertEquals(err.context, { path: "docs/x.md" });
});

Deno.test("AppError: cause is preserved when provided", () => {
  const cause = new Error("disk");
  const err = new ReadFailedError("read failed", { cause });
  assertEquals(err.cause, cause);
});

Deno.test("AppError: toString includes code and message", () => {
  const err = new NotFoundError("missing");
  const s = err.toString();
  assertStringIncludes(s, "NotFoundError");
  assertStringIncludes(s, "NOT_FOUND");
  assertStringIncludes(s, "missing");
});

Deno.test("isAppError: narrows correctly", () => {
  const sentinel: unknown = new NotFoundError("x");
  const plain: unknown = new Error("x");
  assertEquals(isAppError(sentinel), true);
  assertEquals(isAppError(plain), false);
  assertEquals(isAppError(null), false);
  assertEquals(isAppError("string"), false);
});
