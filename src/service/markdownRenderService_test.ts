import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { MarkdownRenderService } from "./markdownRenderService.ts";

const r = new MarkdownRenderService();

Deno.test("GFM table renders <table>", () => {
  const md = `| a | b |\n|---|---|\n| 1 | 2 |\n`;
  const { html } = r.render(md, { relativeDir: "" });
  assertStringIncludes(html, "<table>");
  assertStringIncludes(html, "<th>a</th>");
});

Deno.test("Fenced code block highlighted", () => {
  const md = "```ts\nconst x = 1;\n```\n";
  const { html } = r.render(md, { relativeDir: "" });
  assertStringIncludes(html, "<pre>");
  assertStringIncludes(html, "<code");
  // highlight.js adds spans
  assertStringIncludes(html, "hljs");
});

Deno.test("Relative image src is rewritten to /content/<dir>/<file>", () => {
  const md = "![alt](./a.png)";
  const { html } = r.render(md, { relativeDir: "docs" });
  assertStringIncludes(html, `src="/content/docs/a.png"`);
});

Deno.test("Image with .. in src is blocked", () => {
  const md = "![](../../etc/passwd)";
  const { html, warnings } = r.render(md, { relativeDir: "docs" });
  // Either stripped to # or warned; must not produce a /content/../ url
  assertEquals(html.includes("/content/../"), false);
  assertEquals(warnings.length > 0, true);
});

Deno.test("Mermaid fence preserved for client", () => {
  const md = "```mermaid\ngraph TD; A-->B;\n```";
  const { html } = r.render(md, { relativeDir: "" });
  assertStringIncludes(html, 'class="mermaid"');
  assertStringIncludes(html, "graph TD");
});

Deno.test("Heading anchors + TOC populated", () => {
  const md = `# Hello World

Some text.

## Sub Section
`;
  const { html, toc } = r.render(md, { relativeDir: "" });
  assertEquals(toc.length, 2);
  assertEquals(toc[0].level, 1);
  assertEquals(toc[0].text, "Hello World");
  assertEquals(toc[1].level, 2);
  assertStringIncludes(html, 'id="hello-world"');
  assertStringIncludes(html, "<h1");
  assertStringIncludes(html, "<h2");
});

Deno.test("Malformed markdown does not throw; returns html", () => {
  const md = "```\nunclosed code block\n\n# Title\n\n[[[ unbalanced";
  let result;
  try {
    result = r.render(md, { relativeDir: "" });
  } catch (e) {
    throw new Error(`render threw: ${e}`);
  }
  assertEquals(typeof result.html, "string");
  assertEquals(result.html.length > 0, true);
});

Deno.test("Empty markdown yields empty html", () => {
  const { html } = r.render("", { relativeDir: "" });
  assertEquals(typeof html, "string");
});

Deno.test("Strikethrough works (GFM)", () => {
  const md = "~~struck~~";
  const { html } = r.render(md, { relativeDir: "" });
  assertStringIncludes(html, "<del");
});

Deno.test("External image src preserved as-is", () => {
  const md = "![alt](https://example.com/x.png)";
  const { html } = r.render(md, { relativeDir: "docs" });
  assertStringIncludes(html, `src="https://example.com/x.png"`);
});

Deno.test("Image at root relativeDir", () => {
  const md = "![alt](./x.png)";
  const { html } = r.render(md, { relativeDir: "" });
  assertStringIncludes(html, `src="/content/x.png"`);
});

Deno.test("Heading with duplicate text gets unique id", () => {
  const md = `# Same\n\n# Same\n`;
  const { toc } = r.render(md, { relativeDir: "" });
  assertEquals(toc.length, 2);
  assertEquals(toc[0].id !== toc[1].id, true);
});

Deno.test("TOC is empty for content without headings", () => {
  const { toc } = r.render("Just a paragraph.", { relativeDir: "" });
  assertEquals(toc.length, 0);
});
