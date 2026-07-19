import { assertEquals } from "jsr:@std/assert@^1";
import { filter, type FuzzyItem, score } from "./fuzzy.ts";

Deno.test("score: empty query returns 1 (match anything)", () => {
  assertEquals(score("", "anything"), 1);
});

Deno.test("score: no match returns 0", () => {
  assertEquals(score("zzz", "abc"), 0);
});

Deno.test("score: substring match scores > 0", () => {
  assertEquals(score("mpln", "my-plan") > 0, true);
});

Deno.test("score: leading char match scores higher than mid", () => {
  const lead = score("m", "my-plan");
  const mid = score("p", "my-plan");
  assertEquals(lead > mid, true);
});

Deno.test("score: case-insensitive", () => {
  assertEquals(score("MPL", "my-plan.md") > 0, true);
});

Deno.test("score: boundary char (after / or -) scores higher", () => {
  const wordStart = score("p", "my-plan"); // boundary
  const inside = score("a", "my-plan"); // inside a word
  // boundary: 'p' after '-'; inside: 'a' inside "plan"
  // boundary should win
  assertEquals(wordStart > inside, true);
});

Deno.test("filter: empty query returns all items up to limit", () => {
  const items: FuzzyItem[] = [
    { path: "a.md", label: "A" },
    { path: "b.md", label: "B" },
  ];
  const out = filter(items, "");
  assertEquals(out.length, 2);
});

Deno.test("filter: query filters non-matches and ranks by score", () => {
  const items: FuzzyItem[] = [
    { path: "docs/plans/my-plan.md", label: "My Plan" },
    { path: "docs/other.md", label: "Other" },
    { path: "x/y/z.md", label: "Z" },
  ];
  const out = filter(items, "mpln");
  // "docs/plans/my-plan.md" should be the top result
  assertEquals(out.length, 1);
  assertEquals(out[0].path, "docs/plans/my-plan.md");
});

Deno.test("filter: case-insensitive across path and label", () => {
  const items: FuzzyItem[] = [
    { path: "docs/My-Plan.md", label: "My Plan" },
    { path: "other.md", label: "Other" },
  ];
  const out = filter(items, "MPL");
  assertEquals(out.length, 1);
  assertEquals(out[0].path, "docs/My-Plan.md");
});

Deno.test("filter: respects limit", () => {
  const items: FuzzyItem[] = Array.from({ length: 20 }, (_, i) => ({
    path: `file-${i}.md`,
    label: `File ${i}`,
  }));
  const out = filter(items, "file", 5);
  assertEquals(out.length, 5);
});
