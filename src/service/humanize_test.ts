import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { formatLabel, humanizeBasename, inferKind } from "./humanize.ts";

Deno.test("humanizeBasename: simple kebab", () => {
  assertEquals(humanizeBasename("my-plan.md"), "My Plan");
});

Deno.test("humanizeBasename: underscores", () => {
  assertEquals(humanizeBasename("my_plan.md"), "My Plan");
});

Deno.test("humanizeBasename: mixed separators", () => {
  assertEquals(humanizeBasename("my-cool_plan.md"), "My Cool Plan");
});

Deno.test("humanizeBasename: collapse spaces", () => {
  assertEquals(humanizeBasename("my--plan.md"), "My Plan");
});

Deno.test("humanizeBasename: extensionless", () => {
  assertEquals(humanizeBasename("README"), "Readme");
});

Deno.test("humanizeBasename: html extension", () => {
  assertEquals(humanizeBasename("report.html"), "Report");
});

Deno.test("formatLabel: file at root", () => {
  assertEquals(formatLabel("my-plan.md"), "My Plan");
});

Deno.test("formatLabel: nested file", () => {
  assertEquals(formatLabel("docs/plans/my-plan.md"), "docs/plans › My Plan");
});

Deno.test("formatLabel: deep nesting", () => {
  assertEquals(formatLabel("a/b/c/d.md"), "a/b/c › D");
});

Deno.test("formatLabel: README at root", () => {
  assertEquals(formatLabel("README.md"), "Readme");
});

Deno.test("formatLabel: html in subdir", () => {
  assertEquals(formatLabel("docs/report.html"), "docs › Report");
});

Deno.test("inferKind: markdown", () => {
  assertEquals(inferKind("x.md"), "markdown");
  assertEquals(inferKind("x.markdown"), "markdown");
  assertEquals(inferKind("X.MD"), "markdown");
});

Deno.test("inferKind: html", () => {
  assertEquals(inferKind("x.html"), "html");
  assertEquals(inferKind("x.htm"), "html");
  assertEquals(inferKind("X.HTM"), "html");
});

Deno.test("inferKind: plain", () => {
  assertEquals(inferKind("README"), "plain");
  assertEquals(inferKind("x.txt"), "plain");
});

Deno.test("formatLabel: separator is the exact U+203A character", () => {
  // Ensure consistent separator so UI / API contract is stable
  const result = formatLabel("docs/x.md");
  assertStringIncludes(result, " › ");
});
