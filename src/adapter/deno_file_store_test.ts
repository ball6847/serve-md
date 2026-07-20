import { assertEquals, assertInstanceOf, assertStringIncludes } from "jsr:@std/assert@^1";
import { join, normalize } from "@std/path";
import { DenoFileStore } from "./deno_file_store.ts";
import { AppError, NotFoundError, PathTraversalError, ReadFailedError } from "../domain/errors.ts";

async function makeRoot(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await Deno.makeTempDir({ prefix: "serve-md-fs-" });
  return {
    root,
    cleanup: async () => {
      try {
        await Deno.remove(root, { recursive: true });
      } catch {
        // ignore
      }
    },
  };
}

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(normalize(join(path, "..")), { recursive: true });
  await Deno.writeTextFile(path, content);
}

Deno.test("DenoFileStore: read file inside root", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    const path = join(root, "hello.md");
    await Deno.writeTextFile(path, "hi");
    const store = new DenoFileStore(root);
    const text = await store.readText("hello.md");
    assertEquals(text, "hi");
    const stat = await store.stat("hello.md");
    assertInstanceOf(stat, Object);
    if (stat instanceof AppError) throw stat;
    assertEquals(stat.isFile, true);
    assertEquals(stat.size, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: read nested file via posix relative path", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    await writeFile(join(root, "docs", "sub", "x.md"), "x body");
    const store = new DenoFileStore(root);
    const text = await store.readText("docs/sub/x.md");
    assertEquals(text, "x body");
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: reject .. escape with PathTraversalError", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    const store = new DenoFileStore(root);
    const result = await store.readText("../outside.txt");
    assertInstanceOf(result, PathTraversalError);
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: reject nested a/../../outside", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    const store = new DenoFileStore(root);
    const result = await store.readText("a/../../outside");
    assertInstanceOf(result, PathTraversalError);
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: leading slash treated as relative under root", async () => {
  // Per plan: all user paths treated as relative to content root (strip leading `/`).
  // `/etc/passwd` becomes `etc/passwd` under root — this is relative, not an escape.
  const { root, cleanup } = await makeRoot();
  try {
    await Deno.mkdir(join(root, "etc"));
    await Deno.writeTextFile(join(root, "etc", "passwd"), "fake");
    const store = new DenoFileStore(root);
    const text = await store.readText("/etc/passwd");
    assertEquals(text, "fake");
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: missing file is NotFoundError", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    const store = new DenoFileStore(root);
    const result = await store.readText("missing.md");
    assertInstanceOf(result, NotFoundError);
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: stat on missing file is NotFoundError", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    const store = new DenoFileStore(root);
    const result = await store.stat("nope.md");
    assertInstanceOf(result, NotFoundError);
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: readBytes returns Uint8Array", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    await Deno.writeTextFile(join(root, "blob.bin"), "abcdef");
    const store = new DenoFileStore(root);
    const bytes = await store.readBytes("blob.bin");
    if (bytes instanceof AppError) throw bytes;
    assertEquals(bytes instanceof Uint8Array, true);
    assertEquals(new TextDecoder().decode(bytes), "abcdef");
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: listDir returns entries with relativePath", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    await Deno.writeTextFile(join(root, "a.md"), "");
    await Deno.mkdir(join(root, "docs"));
    await Deno.writeTextFile(join(root, "docs", "b.md"), "");
    const store = new DenoFileStore(root);
    const entries = await store.listDir("");
    if (entries instanceof AppError) throw entries;
    const names = entries.map((e) => e.name).sort();
    assertEquals(names, ["a.md", "docs"]);
    const docsEntry = entries.find((e) => e.name === "docs");
    assertEquals(docsEntry?.isDirectory, true);
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: walkFiles returns all files recursively with posix paths", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    await Deno.writeTextFile(join(root, "a.md"), "");
    await writeFile(join(root, "docs", "x.md"), "");
    await writeFile(join(root, "docs", "sub", "y.md"), "");
    await Deno.writeTextFile(join(root, "ignored.ts"), "");
    const store = new DenoFileStore(root);
    const files = await store.walkFiles("");
    if (files instanceof AppError) throw files;
    // Plan 03: walkFiles returns all files; extension filtering is plan 04.
    const paths = files.map((f) => f.relativePath).sort();
    assertEquals(paths, ["a.md", "docs/sub/y.md", "docs/x.md", "ignored.ts"]);
    // every path is posix-style (no backslashes)
    for (const p of paths) {
      assertEquals(p.includes("\\"), false);
    }
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: symlink escape is rejected with PathTraversalError", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    // Create a file outside root
    const outside = await Deno.makeTempDir({ prefix: "serve-md-out-" });
    const outsideFile = join(outside, "secret.txt");
    await Deno.writeTextFile(outsideFile, "secret");
    try {
      // Symlink inside root pointing outside
      const linkPath = join(root, "link.txt");
      try {
        await Deno.symlink(outsideFile, linkPath);
      } catch (e) {
        // If symlinks aren't supported (e.g. Windows), skip
        if (e instanceof Deno.errors.PermissionDenied || e instanceof Deno.errors.NotSupported) {
          return;
        }
        throw e;
      }
      const store = new DenoFileStore(root);
      const result = await store.readText("link.txt");
      assertInstanceOf(result, PathTraversalError);
    } finally {
      try {
        await Deno.remove(outside, { recursive: true });
      } catch {
        // ignore
      }
    }
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: stat on dir isDirectory=true", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    await Deno.mkdir(join(root, "docs"));
    const store = new DenoFileStore(root);
    const stat = await store.stat("docs");
    if (stat instanceof AppError) throw stat;
    assertEquals(stat.isDirectory, true);
    assertEquals(stat.isFile, false);
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: resolveRelative returns absolute path inside root", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    const store = new DenoFileStore(root);
    const abs = await store.resolveRelative("a/b.md");
    if (abs instanceof AppError) throw abs;
    assertStringIncludes(abs, root);
    assertStringIncludes(abs, "a/b.md");
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: store error classes are AppError", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    const store = new DenoFileStore(root);
    const notFound = await store.readText("nope");
    assertInstanceOf(notFound, NotFoundError);
    const traversal = await store.readText("../x");
    assertInstanceOf(traversal, PathTraversalError);
    // ReadFailedError reserved for actual read failures (permissions) — best-effort
    // covered by integration, not asserted here.
  } finally {
    await cleanup();
  }
});

Deno.test("DenoFileStore: readText returns text or ReadFailedError as value", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    // Plain utf-8 content round-trips
    const path = join(root, "plain.md");
    await Deno.writeTextFile(path, "hello world");
    const store = new DenoFileStore(root);
    const text = await store.readText("plain.md");
    assertEquals(text, "hello world");

    // Invalid utf-8 (lone continuation byte) — Deno's readTextFile either decodes
    // leniently with replacement or throws. Either is acceptable: not a crash.
    const binPath = join(root, "binary.md");
    await Deno.writeFile(binPath, new Uint8Array([0xff, 0xfe, 0xfd]));
    const result = await store.readText("binary.md");
    // If Deno decoded leniently, result is a string — that's fine.
    // If Deno threw, result is a ReadFailedError value.
    if (typeof result === "string") {
      // ok — lenient decoding
    } else {
      assertInstanceOf(result, ReadFailedError);
    }
  } finally {
    await cleanup();
  }
});
