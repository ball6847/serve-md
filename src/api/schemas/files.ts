import type { ContentFile, ContentTreeNode } from "../../domain/contentFile.ts";
import { z } from "zod";

/**
 * Zod schemas for /api files endpoints. Used to validate query params and
 * to type response shapes so handler code stays in sync.
 */

export const PathQuery = z.object({
  path: z.string().min(1, "path is required"),
});

export const ContentFileSchema: z.ZodType<ContentFile> = z.object({
  relativePath: z.string(),
  basename: z.string(),
  humanizedLabel: z.string(),
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
    humanizedLabel: z.string().optional(),
    kind: z.enum(["markdown", "html", "plain"]).optional(),
    children: z.array(ContentTreeNodeSchema).optional(),
  }) as unknown as z.ZodType<ContentTreeNode>
);
