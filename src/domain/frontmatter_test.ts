import { assertEquals } from "jsr:@std/assert@^1";
import { Frontmatter } from "./frontmatter.ts";

// TC-01: Frontmatter parses YAML block correctly
Deno.test("Frontmatter: parses basic YAML frontmatter", () => {
  const { frontmatter, body } = Frontmatter.parse("---\ntitle: Hello\n---\nBody here");
  assertEquals(frontmatter instanceof Frontmatter, true);
  assertEquals(frontmatter?.title, "Hello");
  assertEquals(body, "Body here");
});

Deno.test("Frontmatter: no frontmatter returns null", () => {
  const { frontmatter, body } = Frontmatter.parse("No frontmatter");
  assertEquals(frontmatter, null);
  assertEquals(body, "No frontmatter");
});

Deno.test("Frontmatter: array parsing", () => {
  const { frontmatter } = Frontmatter.parse("---\ntags: [a, b]\n---\nbody");
  assertEquals(frontmatter?.tags, ["a", "b"]);
});

Deno.test("Frontmatter: boolean parsing via get", () => {
  const { frontmatter } = Frontmatter.parse("---\npublished: true\n---\nbody");
  assertEquals(frontmatter?.get("published"), true);
});

Deno.test("Frontmatter: number parsing via get", () => {
  const { frontmatter } = Frontmatter.parse("---\nversion: 1\ncount: 42.5\n---\nbody");
  assertEquals(frontmatter?.get("version"), 1);
  assertEquals(frontmatter?.get("count"), 42.5);
});

Deno.test("Frontmatter: quoted values", () => {
  const { frontmatter } = Frontmatter.parse(`---\ntitle: "My Title"\ndesc: 'single'\n---\nbody`);
  assertEquals(frontmatter?.title, "My Title");
  assertEquals(frontmatter?.get("desc"), "single");
});

Deno.test("Frontmatter: empty frontmatter returns null", () => {
  const { frontmatter, body } = Frontmatter.parse("---\n---\n# Hello");
  assertEquals(frontmatter, null);
  assertEquals(body, "---\n---\n# Hello");
});

// TC-02: Frontmatter is immutable
Deno.test("Frontmatter: toJSON returns a copy (immutability)", () => {
  const { frontmatter } = Frontmatter.parse("---\ntitle: Hello\n---\nbody");
  const json = frontmatter?.toJSON();
  json!["title"] = "Mutated";
  assertEquals(frontmatter?.title, "Hello");
});

Deno.test("Frontmatter: get returns undefined for missing key", () => {
  const { frontmatter } = Frontmatter.parse("---\ntitle: Hello\n---\nbody");
  assertEquals(frontmatter?.get("nonexistent"), undefined);
});

Deno.test("Frontmatter: tags getter returns undefined when absent", () => {
  const { frontmatter } = Frontmatter.parse("---\ntitle: Hello\n---\nbody");
  assertEquals(frontmatter?.tags, undefined);
});
