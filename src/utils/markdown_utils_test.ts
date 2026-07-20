import { assertEquals } from "jsr:@std/assert@^1";
import {
  slugify,
  escapeHtml,
  unescapeHtml,
  escapeAttr,
  isMarkdownLink,
  extOf,
} from "./markdown_utils.ts";

// TC-07: slugify produces stable IDs
Deno.test("slugify: Hello World → hello-world", () => {
  assertEquals(slugify("Hello World"), "hello-world");
});

Deno.test("slugify: multiple spaces collapsed", () => {
  assertEquals(slugify("  Multiple   Spaces  "), "multiple-spaces");
});

Deno.test("slugify: empty string falls back to section", () => {
  assertEquals(slugify(""), "section");
});

Deno.test("slugify: strips HTML tags", () => {
  assertEquals(slugify("Hello <b>World</b>"), "hello-world");
});

Deno.test("slugify: removes special chars", () => {
  assertEquals(slugify("Hello, World! @#$"), "hello-world");
});

Deno.test("slugify: truncates to 80 chars", () => {
  const long = "a".repeat(100);
  assertEquals(slugify(long).length, 80);
});

// escapeHtml / unescapeHtml / escapeAttr
Deno.test("escapeHtml: encodes & < > \" '", () => {
  assertEquals(escapeHtml(`& < > " '`), "&amp; &lt; &gt; &quot; &#39;");
});

Deno.test("unescapeHtml: decodes entities back", () => {
  assertEquals(unescapeHtml("&amp; &lt; &gt; &quot; &#39; &nbsp;"), `& < > " '  `);
});

Deno.test("escapeAttr: delegates to escapeHtml", () => {
  assertEquals(escapeAttr(`<script>`), "&lt;script&gt;");
});

// isMarkdownLink
Deno.test("isMarkdownLink: detects .md", () => {
  assertEquals(isMarkdownLink("./other.md"), true);
});

Deno.test("isMarkdownLink: detects .markdown", () => {
  assertEquals(isMarkdownLink("./readme.markdown"), true);
});

Deno.test("isMarkdownLink: ignores anchor", () => {
  assertEquals(isMarkdownLink("./other.md#section"), true);
});

Deno.test("isMarkdownLink: rejects .html", () => {
  assertEquals(isMarkdownLink("./page.html"), false);
});

// extOf
Deno.test("extOf: .md", () => {
  assertEquals(extOf("readme.md"), ".md");
});

Deno.test("extOf: .markdown", () => {
  assertEquals(extOf("readme.markdown"), ".markdown");
});

Deno.test("extOf: no extension", () => {
  assertEquals(extOf("README"), "");
});

Deno.test("extOf: dotfile without extension", () => {
  assertEquals(extOf(".gitignore"), ".gitignore");
});
