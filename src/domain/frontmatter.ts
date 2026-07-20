/**
 * Value object: parsed YAML frontmatter from a markdown document.
 *
 * Frontmatter is immutable — constructed only via {@link Frontmatter.parse}.
 * It encapsulates the raw key/value data and exposes typed convenience getters
 * for common fields (title, tags) plus a generic {@link get} accessor.
 */
export class Frontmatter {
  readonly #data: Record<string, unknown>;

  private constructor(data: Record<string, unknown>) {
    this.#data = data;
  }

  /**
   * Parse YAML frontmatter from markdown source.
   *
   * Returns the parsed Frontmatter (or null if no `---` block is present) and
   * the body with the frontmatter block removed.
   *
   * Uses a simple key: value parser — sufficient for common metadata fields.
   */
  static parse(markdown: string): { frontmatter: Frontmatter | null; body: string } {
    const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (!match) {
      return { frontmatter: null, body: markdown };
    }

    const yamlStr = match[1];
    const body = markdown.slice(match[0].length);
    const data: Record<string, unknown> = {};

    for (const line of yamlStr.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      // Remove quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Parse arrays: [a, b, c]
      if (value.startsWith("[") && value.endsWith("]")) {
        data[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""));
        continue;
      }
      // Parse booleans
      if (value === "true") {
        data[key] = true;
        continue;
      }
      if (value === "false") {
        data[key] = false;
        continue;
      }
      // Parse numbers
      if (/^\d+(\.\d+)?$/.test(value)) {
        data[key] = Number(value);
        continue;
      }
      if (value) data[key] = value;
    }

    if (Object.keys(data).length === 0) {
      return { frontmatter: null, body: markdown };
    }
    return { frontmatter: new Frontmatter(data), body };
  }

  /** Generic accessor — returns undefined if key absent. */
  get(key: string): unknown {
    return this.#data[key];
  }

  /** Typed convenience getter for the common `title` field. */
  get title(): string | undefined {
    return this.#data["title"] as string | undefined;
  }

  /** Typed convenience getter for the common `tags` field. */
  get tags(): string[] | undefined {
    return this.#data["tags"] as string[] | undefined;
  }

  /** Returns a shallow copy of the raw data. */
  toJSON(): Record<string, unknown> {
    return { ...this.#data };
  }
}
