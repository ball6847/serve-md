import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { ContentPath } from "./content_path.ts";

// TC-03: ContentPath.isContentFile detects valid extensions
Deno.test("ContentPath.isContentFile: .md is content", () => {
  assertEquals(new ContentPath("docs/readme.md").isContentFile(), true);
});

Deno.test("ContentPath.isContentFile: .markdown is content", () => {
  assertEquals(new ContentPath("readme.markdown").isContentFile(), true);
});

Deno.test("ContentPath.isContentFile: .html is content", () => {
  assertEquals(new ContentPath("page.html").isContentFile(), true);
});

Deno.test("ContentPath.isContentFile: .htm is content", () => {
  assertEquals(new ContentPath("page.htm").isContentFile(), true);
});

Deno.test("ContentPath.isContentFile: .css is not content", () => {
  assertEquals(new ContentPath("assets/style.css").isContentFile(), false);
});

Deno.test("ContentPath.isContentFile: extensionless is not content", () => {
  assertEquals(new ContentPath("README").isContentFile(), false);
});

// TC-04: ContentPath.isExcluded enforces dot-path and vendor rules
Deno.test("ContentPath.isExcluded: .git path excluded", () => {
  assertEquals(new ContentPath(".git/config").isExcluded([]), true);
});

Deno.test("ContentPath.isExcluded: whitelisted dot path allowed", () => {
  assertEquals(new ContentPath(".context/plans").isExcluded([".context"]), false);
});

Deno.test("ContentPath.isExcluded: node_modules excluded", () => {
  assertEquals(new ContentPath("src/node_modules/foo").isExcluded([]), true);
});

Deno.test("ContentPath.isExcluded: normal docs path allowed", () => {
  assertEquals(new ContentPath("docs/readme.md").isExcluded([]), false);
});

Deno.test("ContentPath.isExcluded: dist excluded", () => {
  assertEquals(new ContentPath("dist/bundle.js").isExcluded([]), true);
});

Deno.test("ContentPath.isExcluded: build excluded", () => {
  assertEquals(new ContentPath("build/out.md").isExcluded([]), true);
});

Deno.test("ContentPath.isExcluded: vendor excluded", () => {
  assertEquals(new ContentPath("vendor/dep.md").isExcluded([]), true);
});

Deno.test("ContentPath.isExcluded: target excluded", () => {
  assertEquals(new ContentPath("target/x.md").isExcluded([]), true);
});

Deno.test("ContentPath.isExcluded: deep dot path excluded without whitelist", () => {
  assertEquals(new ContentPath(".idea/config/settings.json").isExcluded([]), true);
});

Deno.test("ContentPath.isExcluded: empty path not excluded", () => {
  assertEquals(new ContentPath("").isExcluded([]), false);
});

// TC-05: ContentPath.resolveMarkdownLink produces deep-link paths
Deno.test("ContentPath.resolveMarkdownLink: relative link with dir", () => {
  assertEquals(
    new ContentPath("docs/guide.md").resolveMarkdownLink("./other.md"),
    "/docs/other.md",
  );
});

Deno.test("ContentPath.resolveMarkdownLink: anchor preserved", () => {
  assertEquals(
    new ContentPath("docs/guide.md").resolveMarkdownLink("./other.md#section"),
    "/docs/other.md#section",
  );
});

Deno.test("ContentPath.resolveMarkdownLink: root relativePath", () => {
  assertEquals(new ContentPath("README.md").resolveMarkdownLink("README.md"), "/README.md");
});

Deno.test("ContentPath.resolveMarkdownLink: parent dir link", () => {
  assertEquals(
    new ContentPath("docs/guide/_.md").resolveMarkdownLink("../index.md"),
    "/docs/index.md",
  );
});

// TC-06: ContentPath.rewriteImageSrc blocks traversal
Deno.test("ContentPath.rewriteImageSrc: blocks .. traversal", () => {
  const warnings: string[] = [];
  const result = new ContentPath("posts/_.md").rewriteImageSrc("../../../etc/passwd", warnings);
  assertEquals(result, "#");
  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0], "..");
});

Deno.test("ContentPath.rewriteImageSrc: relative image rewritten to /content/", () => {
  const warnings: string[] = [];
  const result = new ContentPath("posts/_.md").rewriteImageSrc("img.png", warnings);
  assertEquals(result, "/content/posts/img.png");
  assertEquals(warnings.length, 0);
});

Deno.test("ContentPath.rewriteImageSrc: https URL preserved unchanged", () => {
  const warnings: string[] = [];
  const result = new ContentPath("posts/_.md").rewriteImageSrc(
    "https://example.com/x.png",
    warnings,
  );
  assertEquals(result, "https://example.com/x.png");
});

Deno.test("ContentPath.rewriteImageSrc: data URI preserved", () => {
  const warnings: string[] = [];
  const result = new ContentPath("posts/_.md").rewriteImageSrc(
    "data:image/png;base64,abc",
    warnings,
  );
  assertEquals(result, "data:image/png;base64,abc");
});

Deno.test("ContentPath.rewriteImageSrc: /content/ path preserved", () => {
  const warnings: string[] = [];
  const result = new ContentPath("posts/_.md").rewriteImageSrc("/content/foo.png", warnings);
  assertEquals(result, "/content/foo.png");
});

Deno.test("ContentPath.rewriteImageSrc: root directory resolves image correctly", () => {
  const warnings: string[] = [];
  const result = new ContentPath("_.md").rewriteImageSrc("x.png", warnings);
  assertEquals(result, "/content/x.png");
});

// Getters
Deno.test("ContentPath.basename: root-level file", () => {
  assertEquals(new ContentPath("readme.md").basename, "readme.md");
});

Deno.test("ContentPath.basename: nested file", () => {
  assertEquals(new ContentPath("docs/guide/intro.md").basename, "intro.md");
});

Deno.test("ContentPath.extension: with extension", () => {
  assertEquals(new ContentPath("docs/readme.md").extension, ".md");
});

Deno.test("ContentPath.extension: no extension", () => {
  assertEquals(new ContentPath("README").extension, "");
});

Deno.test("ContentPath.directory: nested file", () => {
  assertEquals(new ContentPath("docs/guide/intro.md").directory, "docs/guide");
});

Deno.test("ContentPath.directory: root-level file", () => {
  assertEquals(new ContentPath("readme.md").directory, ".");
});
