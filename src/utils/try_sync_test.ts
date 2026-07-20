import { assertEquals, assertExists } from "@std/assert";
import { trySync } from "./try_sync.ts";

Deno.test("trySync: returns [undefined, value] on success", () => {
  const [err, value] = trySync(() => 42);
  assertEquals(err, undefined);
  assertEquals(value, 42);
});

Deno.test("trySync: returns [error, undefined] on throw", () => {
  const testErr = new Error("boom");
  const [err, value] = trySync(() => {
    throw testErr;
  });
  assertEquals(err, testErr);
  assertEquals(value, undefined);
});

Deno.test("trySync: onError transforms the error", () => {
  class CustomError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "CustomError";
    }
  }
  const [err, value] = trySync(
    () => {
      throw new Error("raw");
    },
    (e) => new CustomError(String(e)),
  );
  assertExists(err);
  assertEquals(err.name, "CustomError");
  assertEquals(value, undefined);
});

Deno.test("trySync: works with objects", () => {
  const obj = { a: 1, b: 2 };
  const [err, value] = trySync(() => obj);
  assertEquals(err, undefined);
  assertEquals(value, obj);
});

Deno.test("trySync: works with functions that return undefined", () => {
  const [err, value] = trySync(() => {
    /* void */
  });
  assertEquals(err, undefined);
  assertEquals(value, undefined);
});
