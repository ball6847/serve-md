import { z } from "zod";

/**
 * Final merged config schema, validated by zod at startup.
 * Env + flags are merged before parsing.
 */
export const ConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  host: z.string(),
  contentRoot: z.string().min(1),
  watch: z.boolean(),
  open: z.boolean(),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
  dotWhitelist: z.array(z.string()),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
