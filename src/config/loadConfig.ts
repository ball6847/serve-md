import { resolve } from "@std/path";
import { type AppConfig, ConfigSchema } from "./schema.ts";
import { ConfigInvalidError } from "../domain/errors.ts";

/**
 * Raw flags as parsed from Cliffy. Undefined means "not set" — the env or
 * default may still apply.
 */
export interface RawFlags {
  port?: number | undefined;
  network: boolean;
  watch: boolean;
  root?: string | undefined;
}

export interface ConfigInput {
  flags: RawFlags;
  env: Record<string, string | undefined>;
  cwd: string;
}

/**
 * Merge env + flags (CLI wins) and validate. Returns either a fully-validated
 * `AppConfig` or a `ConfigInvalidError` sentinel. Caller (CLI) decides whether
 * to print + exit.
 *
 * `safeParse` is synchronous and does not throw, so no `to()` wrapper.
 */
export function parseConfig(input: ConfigInput): AppConfig | ConfigInvalidError {
  const portRaw = input.flags.port ?? input.env.PORT;
  const logLevelRaw = input.env.LOG_LEVEL;
  const dotWhitelistRaw = input.env.SERVE_MD_DOT_WHITELIST;

  const port = portRaw === undefined ? 8787 : Number(portRaw);
  const host = input.flags.network ? "0.0.0.0" : "127.0.0.1";
  const contentRoot = resolve(input.cwd, input.flags.root ?? ".");
  const watch = input.flags.watch;
  const logLevel = logLevelRaw ?? "info";
  const dotWhitelist = parseDotWhitelist(dotWhitelistRaw);

  const candidate = {
    port,
    host,
    contentRoot,
    watch,
    logLevel,
    dotWhitelist,
  };

  const parsed = ConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    return new ConfigInvalidError(formatZodIssues(parsed.error.issues), {
      context: { issues: parsed.error.issues },
    });
  }
  return parsed.data;
}

function parseDotWhitelist(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function formatZodIssues(
  issues: { path: (string | number)[]; message: string }[],
): string {
  return issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
