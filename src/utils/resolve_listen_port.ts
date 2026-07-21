/**
 * Resolve the TCP port to pass to Deno.serve.
 *
 * Probes the preferred port with a short-lived listener (not HTTP serve).
 * If free, returns that port. If AddrInUse, returns 0 so the OS assigns
 * any free port when Deno.serve starts.
 */

import { trySync } from "./try_sync.ts";

export interface ListenOptions {
  hostname: string;
  port: number;
}

/** Minimal listener shape — Deno.Listener or a test double. */
export interface CloseableListener {
  close(): void;
}

export type ListenFn = (options: ListenOptions) => CloseableListener;

export interface ResolveListenPortOk {
  /** Port to pass to Deno.serve (preferred, or 0 for OS assign). */
  port: number;
  /** Configured / requested preferred port. */
  preferred: number;
  /** True when preferred was busy and port 0 will be used. */
  usedFallback: boolean;
}

export type ResolveListenPortResult = ResolveListenPortOk | Error;

function isAddrInUse(err: unknown): boolean {
  if (err instanceof Deno.errors.AddrInUse) {
    return true;
  }
  // Test doubles and cross-realm errors may only share the name.
  if (err instanceof Error && err.name === "AddrInUse") {
    return true;
  }
  return false;
}

/**
 * Probe `preferred` on `hostname`. Returns the listen port for Deno.serve,
 * or an Error if the probe fails for a reason other than address-in-use.
 *
 * @param hostname Bind hostname (same as eventual Deno.serve hostname).
 * @param preferred Preferred port from config (1–65535).
 * @param listen Optional inject for tests (defaults to Deno.listen).
 */
export function resolveListenPort(
  hostname: string,
  preferred: number,
  listen: ListenFn = (opts) => Deno.listen(opts),
): ResolveListenPortResult {
  const [err, listener] = trySync(() => listen({ hostname, port: preferred }));

  if (!err && listener) {
    const [closeErr] = trySync(() => {
      listener.close();
    });
    if (closeErr) {
      return closeErr instanceof Error ? closeErr : new Error(String(closeErr));
    }
    return { port: preferred, preferred, usedFallback: false };
  }

  if (isAddrInUse(err)) {
    return { port: 0, preferred, usedFallback: true };
  }

  if (err instanceof Error) {
    return err;
  }
  return new Error(String(err));
}
