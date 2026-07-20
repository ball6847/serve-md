import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { ContentIndexService } from "./content_index.ts";
import { FakeFileStore } from "../adapter/fake_file_store.ts";

function makeStore(): FakeFileStore {
  const store = new FakeFileStore("/root");
  return store;
}

Deno.test("ContentIndexService: only md/html/htm indexed (case-insensitive)", async () => {
  const store = makeStore();
  store.add("a.ts", "ignored");
  store.add("b.md", "ok");
  store.add("c.HTML", "ok");
  store.add("d.htm", "ok");
  store.add("e.txt", "ignored");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  assertEquals(await svc.refresh(), null);
  const files = svc.listFiles();
  const paths = files.map((f) => f.relativePath).sort();
  assertEquals(paths, ["b.md", "c.HTML", "d.htm"]);
  const html = files.find((f) => f.relativePath === "c.HTML");
  assertEquals(html?.kind, "html");
  const md = files.find((f) => f.relativePath === "b.md");
  assertEquals(md?.kind, "markdown");
});

Deno.test("ContentIndexService: dot exclusion and whitelist", async () => {
  const store = makeStore();
  store.add(".git/x.md", "");
  store.add(".context/plan.md", "");
  store.add("ok.md", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [".context"] });
  await svc.refresh();
  const paths = svc.listFiles().map((f) => f.relativePath).sort();
  assertEquals(paths, [".context/plan.md", "ok.md"]);
});

Deno.test("ContentIndexService: dot segments without whitelist all excluded", async () => {
  const store = makeStore();
  store.add(".git/x.md", "");
  store.add(".idea/y.md", "");
  store.add("ok.md", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  const paths = svc.listFiles().map((f) => f.relativePath).sort();
  assertEquals(paths, ["ok.md"]);
});

Deno.test("ContentIndexService: node_modules/dist/build/vendor/target excluded", async () => {
  const store = makeStore();
  store.add("node_modules/pkg/README.md", "x");
  store.add("dist/bundle.md", "x");
  store.add("build/out.md", "x");
  store.add("vendor/dep.md", "x");
  store.add("target/x.md", "x");
  store.add("src/main.md", "ok");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  const paths = svc.listFiles().map((f) => f.relativePath).sort();
  assertEquals(paths, ["src/main.md"]);
});

Deno.test("ContentIndexService: tree prunes dirs without content", async () => {
  const store = makeStore();
  store.add("src/main.md", "");
  store.add("docs/a.md", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  const tree = svc.getTree();
  const topNames = tree.children?.map((c) => c.name).sort() ?? [];
  assertEquals(topNames, ["docs", "src"]);
  // src has a file child
  const src = tree.children?.find((c) => c.name === "src");
  assertEquals(src?.type, "dir");
  const srcChild = src?.children?.map((c) => c.name);
  assertEquals(srcChild, ["main.md"]);
});

Deno.test("ContentIndexService: tree omits empty src if src has no content files", async () => {
  const store = makeStore();
  store.add("src/index.ts", "");
  store.add("docs/a.md", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  const tree = svc.getTree();
  const topNames = tree.children?.map((c) => c.name) ?? [];
  assertEquals(topNames, ["docs"]);
});

Deno.test("ContentIndexService: default open order — README.md wins over readme.md", async () => {
  const store = makeStore();
  store.add("README.md", "");
  store.add("readme.md", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  assertEquals(await svc.resolveDefaultOpen(), "README.md");
});

Deno.test("ContentIndexService: default open — only readme.md present", async () => {
  const store = makeStore();
  store.add("readme.md", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  assertEquals(await svc.resolveDefaultOpen(), "readme.md");
});

Deno.test("ContentIndexService: default open — extensionless README wins when no md", async () => {
  const store = makeStore();
  store.add("README", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  assertEquals(await svc.resolveDefaultOpen(), "README");
});

Deno.test("ContentIndexService: default open — README.md still wins over extensionless README", async () => {
  const store = makeStore();
  store.add("README", "");
  store.add("README.md", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  assertEquals(await svc.resolveDefaultOpen(), "README.md");
});

Deno.test("ContentIndexService: default open — null when nothing present", async () => {
  const store = makeStore();
  store.add("a.md", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  assertEquals(await svc.resolveDefaultOpen(), null);
});

Deno.test("ContentIndexService: listFiles sorted by relativePath ascending", async () => {
  const store = makeStore();
  store.add("z.md", "");
  store.add("a.md", "");
  store.add("m.md", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  const paths = svc.listFiles().map((f) => f.relativePath);
  assertEquals(paths, ["a.md", "m.md", "z.md"]);
});

Deno.test("ContentIndexService: getFile returns ContentFile for known path", async () => {
  const store = makeStore();
  store.add("docs/a.md", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  const f = svc.getFile("docs/a.md");
  assertEquals(f?.relativePath, "docs/a.md");
  assertEquals(svc.getFile("nope.md"), undefined);
});

Deno.test("ContentIndexService: refresh on empty store yields empty list", async () => {
  const store = makeStore();
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  assertEquals(svc.listFiles(), []);
  assertEquals(svc.getTree().children, []);
});

Deno.test("ContentIndexService: tree has correct file kind", async () => {
  const store = makeStore();
  store.add("x.md", "");
  store.add("y.html", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  const tree = svc.getTree();
  const files = tree.children?.filter((c) => c.type === "file") ?? [];
  const kinds = files.map((f) => f.kind).sort();
  assertEquals(kinds, ["html", "markdown"]);
});

Deno.test("ContentIndexService: extensionless README absent from listFiles", async () => {
  const store = makeStore();
  store.add("README", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  assertEquals(svc.listFiles(), []);
  // But default-open still finds it
  assertEquals(await svc.resolveDefaultOpen(), "README");
});

Deno.test("ContentIndexService: refresh failure keeps previous index", async () => {
  // First refresh works
  const store = makeStore();
  store.add("a.md", "");
  const svc = new ContentIndexService(store, { dotWhitelist: [] });
  await svc.refresh();
  assertEquals(svc.listFiles().length, 1);
  // Now make walkFiles reject by swapping the method on the instance
  (store as unknown as { walkFiles: () => Promise<never> }).walkFiles = () => {
    return Promise.reject(new Error("disk gone"));
  };
  const err = await svc.refresh();
  assertEquals(err === null, false);
  // Previous index preserved
  assertEquals(svc.listFiles().length, 1);
  assertStringIncludes(svc.lastError()?.message ?? "", "index refresh failed");
});
