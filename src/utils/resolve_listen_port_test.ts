import { assertEquals, assertInstanceOf } from "jsr:@std/assert@^1";
import {
  type CloseableListener,
  type ListenOptions,
  resolveListenPort,
} from "./resolve_listen_port.ts";

function freeListen(): (opts: ListenOptions) => CloseableListener {
  let closed = false;
  return (_opts) => ({
    close() {
      closed = true;
    },
    get closed() {
      return closed;
    },
  });
}

Deno.test("resolveListenPort: preferred free → return preferred, no fallback", () => {
  let closed = false;
  const result = resolveListenPort("127.0.0.1", 8787, (_opts) => ({
    close() {
      closed = true;
    },
  }));

  assertEquals(result instanceof Error, false);
  if (result instanceof Error) {
    return;
  }
  assertEquals(result.port, 8787);
  assertEquals(result.preferred, 8787);
  assertEquals(result.usedFallback, false);
  assertEquals(closed, true);
});

Deno.test("resolveListenPort: AddrInUse → port 0 fallback", () => {
  const result = resolveListenPort("127.0.0.1", 8787, () => {
    throw new Deno.errors.AddrInUse("Address already in use");
  });

  assertEquals(result instanceof Error, false);
  if (result instanceof Error) {
    return;
  }
  assertEquals(result.port, 0);
  assertEquals(result.preferred, 8787);
  assertEquals(result.usedFallback, true);
});

Deno.test("resolveListenPort: AddrInUse by name only (test double) → fallback", () => {
  const err = new Error("busy");
  err.name = "AddrInUse";
  const result = resolveListenPort("0.0.0.0", 3000, () => {
    throw err;
  });

  assertEquals(result instanceof Error, false);
  if (result instanceof Error) {
    return;
  }
  assertEquals(result.port, 0);
  assertEquals(result.preferred, 3000);
  assertEquals(result.usedFallback, true);
});

Deno.test("resolveListenPort: unexpected probe error is returned", () => {
  const result = resolveListenPort("127.0.0.1", 8787, () => {
    throw new Error("permission denied");
  });

  assertInstanceOf(result, Error);
  assertEquals((result as Error).message, "permission denied");
});

Deno.test("resolveListenPort: probe receives hostname and preferred port", () => {
  let seen: ListenOptions | undefined;
  resolveListenPort("127.0.0.1", 9999, (opts) => {
    seen = opts;
    return freeListen()(opts);
  });
  assertEquals(seen, { hostname: "127.0.0.1", port: 9999 });
});

Deno.test("resolveListenPort: integration — real free port probe then OS fallback path", () => {
  // Bind a real port, then resolve with that port as preferred → fallback to 0.
  const holder = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const busyPort = (holder.addr as Deno.NetAddr).port;

  const result = resolveListenPort("127.0.0.1", busyPort);

  holder.close();

  assertEquals(result instanceof Error, false);
  if (result instanceof Error) {
    return;
  }
  assertEquals(result.port, 0);
  assertEquals(result.preferred, busyPort);
  assertEquals(result.usedFallback, true);
});
