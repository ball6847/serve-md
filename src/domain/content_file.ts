/**
 * Content types shared between the index service and the HTTP layer.
 */
export type ContentKind = "markdown" | "html" | "plain";

export interface ContentFile {
  /** posix-style path relative to content root */
  relativePath: string;
  basename: string;
  kind: ContentKind;
  size: number;
  mtime: Date | null;
}

export interface ContentTreeNode {
  /** segment name */
  name: string;
  /** dir or file path relative to content root */
  relativePath: string;
  type: "dir" | "file";
  kind?: ContentKind;
  children?: ContentTreeNode[];
}
