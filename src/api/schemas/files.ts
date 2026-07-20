import type { ContentFile, ContentTreeNode } from "../../domain/content_file.ts";
import { z } from "zod";

/**
 * Zod schemas for /api files endpoints. Used to validate request inputs and
 * to type response shapes so handler code stays in sync.
 *
 * File identity is extracted from the URL path (e.g. `/api/file/<rel>`),
 * not from query parameters.
 */

export const ContentFileSchema: z.ZodType<ContentFile> = z.object({
  relativePath: z.string(),
  basename: z.string(),
  kind: z.enum(["markdown", "html", "plain"]),
  size: z.number(),
  mtime: z.union([z.date(), z.null()]),
});

export const ContentFileListSchema = z.object({
  data: z.array(ContentFileSchema),
});

export const ContentTreeNodeSchema: z.ZodType<ContentTreeNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    relativePath: z.string(),
    type: z.enum(["dir", "file"]),
    kind: z.enum(["markdown", "html", "plain"]).optional(),
    children: z.array(ContentTreeNodeSchema).optional(),
  }) as unknown as z.ZodType<ContentTreeNode>
);
