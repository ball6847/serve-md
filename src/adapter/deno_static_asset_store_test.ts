import { assertEquals, assertStringIncludes } from "@std/assert";
import { DenoStaticAssetStore } from "./deno_static_asset_store.ts";
import { AppError } from "../domain/errors.ts";

async function makeTempUiDir(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir();
  const uiDir = `${dir}/src/ui`;
  await Deno.mkdir(uiDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await Deno.writeTextFile(`${uiDir}/${name}`, content);
  }
  return dir;
}

Deno.test("local mode: readIndex replaces {{ brand }} placeholder", async () => {
  const dir = await makeTempUiDir({
    "index.html": "<title>{{ brand }}</title>",
  });
  const store = new DenoStaticAssetStore("My Docs", {
    moduleUrl: new URL(`file://${dir}/src/adapter/deno_static_asset_store.ts`),
  });

  const result = await store.readIndex();
  if (result instanceof AppError) {
    throw new Error(`unexpected error: ${result.message}`);
  }
  assertEquals(result, "<title>My Docs</title>");
});

Deno.test("local mode: readAsset returns CSS and JS assets", async () => {
  const dir = await makeTempUiDir({
    "styles.css": ":root { color: red; }",
    "app.js": "console.log('ok');",
  });
  const store = new DenoStaticAssetStore("test", {
    moduleUrl: new URL(`file://${dir}/src/adapter/deno_static_asset_store.ts`),
  });

  const css = await store.readAsset("styles.css");
  if (css instanceof AppError) {
    throw new Error(`unexpected error: ${css.message}`);
  }
  assertEquals(css.contentType, "text/css; charset=utf-8");
  assertEquals(css.content, ":root { color: red; }");

  const js = await store.readAsset("app.js");
  if (js instanceof AppError) {
    throw new Error(`unexpected error: ${js.message}`);
  }
  assertEquals(js.contentType, "application/javascript; charset=utf-8");
  assertEquals(js.content, "console.log('ok');");
});

Deno.test("local mode: readAsset returns NotFoundError for missing file", async () => {
  const dir = await makeTempUiDir({});
  const store = new DenoStaticAssetStore("test", {
    moduleUrl: new URL(`file://${dir}/src/adapter/deno_static_asset_store.ts`),
  });

  const result = await store.readAsset("missing.css");
  if (!(result instanceof AppError)) {
    throw new Error("expected AppError");
  }
  assertEquals(result.code, "NOT_FOUND");
});

Deno.test("remote mode: readIndex fetches and caches from pinned JSR URL", async () => {
  const calls: string[] = [];
  const store = new DenoStaticAssetStore("My Docs", {
    moduleUrl: "https://jsr.io/@ball6847/serve-md/1.2.3/src/adapter/deno_static_asset_store.ts",
    fetch: (url: URL) => {
      calls.push(url.href);
      return Promise.resolve(new Response("<title>{{ brand }}</title>", { status: 200 }));
    },
  });

  const first = await store.readIndex();
  if (first instanceof AppError) {
    throw new Error(`unexpected error: ${first.message}`);
  }
  assertEquals(first, "<title>My Docs</title>");
  assertEquals(calls.length, 1);
  assertStringIncludes(
    calls[0],
    "https://jsr.io/@ball6847/serve-md/1.2.3/src/ui/index.html",
  );

  const second = await store.readIndex();
  assertEquals(second, "<title>My Docs</title>");
  // Second call should be served from cache, so no extra fetch.
  assertEquals(calls.length, 1);
});

Deno.test("remote mode: readAsset returns NotFoundError on 404", async () => {
  const store = new DenoStaticAssetStore("test", {
    moduleUrl: "https://jsr.io/@ball6847/serve-md/1.0.0/src/adapter/deno_static_asset_store.ts",
    fetch: () => Promise.resolve(new Response("not found", { status: 404 })),
  });

  const result = await store.readAsset("missing.css");
  if (!(result instanceof AppError)) {
    throw new Error("expected AppError");
  }
  assertEquals(result.code, "NOT_FOUND");
});

Deno.test("remote mode: fetch failure returns ReadFailedError", async () => {
  const store = new DenoStaticAssetStore("test", {
    moduleUrl: "https://jsr.io/@ball6847/serve-md/1.0.0/src/adapter/deno_static_asset_store.ts",
    fetch: () => {
      return Promise.reject(new TypeError("network error"));
    },
  });

  const result = await store.readAsset("app.js");
  if (!(result instanceof AppError)) {
    throw new Error("expected AppError");
  }
  assertEquals(result.code, "READ_FAILED");
  assertStringIncludes(result.message, "ensure --allow-net includes");
});

Deno.test("readAsset rejects path traversal", async () => {
  const dir = await makeTempUiDir({});
  const store = new DenoStaticAssetStore("test", {
    moduleUrl: new URL(`file://${dir}/src/adapter/deno_static_asset_store.ts`),
  });

  for (const filename of ["../secret.css", "styles/../secret.css", "", "foo.txt"]) {
    const result = await store.readAsset(filename);
    if (!(result instanceof AppError)) {
      throw new Error(`expected AppError for ${filename}`);
    }
    assertEquals(result.code, "PATH_TRAVERSAL");
  }
});

Deno.test("mode and baseUrl reflect the module URL", () => {
  const local = new DenoStaticAssetStore("test", {
    moduleUrl: "file:///project/src/adapter/deno_static_asset_store.ts",
  });
  assertEquals(local.mode, "local");
  assertEquals(local.baseUrl.href, "file:///project/src/ui/");

  const remote = new DenoStaticAssetStore("test", {
    moduleUrl: "https://jsr.io/@ball6847/serve-md/9.8.7/src/adapter/deno_static_asset_store.ts",
    fetch: () => Promise.resolve(new Response("", { status: 404 })),
  });
  assertEquals(remote.mode, "remote");
  assertEquals(
    remote.baseUrl.href,
    "https://jsr.io/@ball6847/serve-md/9.8.7/src/ui/",
  );
});
