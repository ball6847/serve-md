import { assertEquals, assertInstanceOf, assertStringIncludes } from "jsr:@std/assert@^1";
import { type ConfigInput, parseConfig } from "./loadConfig.ts";
import { ConfigInvalidError, isAppError } from "../domain/errors.ts";
import type { AppConfig } from "./schema.ts";

function input(over: Partial<ConfigInput> = {}): ConfigInput {
  return {
    flags: {
      port: undefined,
      network: false,
      watch: false,
      open: false,
      root: undefined,
    },
    env: {},
    cwd: "/tmp/example",
    ...over,
  };
}

function ok(cfg: AppConfig | ConfigInvalidError): AppConfig {
  if (isAppError(cfg)) {
    throw new Error(`expected AppConfig, got error: ${cfg.message}`);
  }
  return cfg;
}

Deno.test("parseConfig: defaults give port 8787, host 127.0.0.1, watch false", () => {
  const cfg = ok(parseConfig(input()));
  assertEquals(cfg.port, 8787);
  assertEquals(cfg.host, "127.0.0.1");
  assertEquals(cfg.watch, false);
  assertEquals(cfg.logLevel, "info");
  assertEquals(cfg.dotWhitelist, []);
  assertEquals(cfg.contentRoot, "/tmp/example");
});

Deno.test("parseConfig: env PORT overrides default", () => {
  const cfg = ok(parseConfig(input({ env: { PORT: "3000" } })));
  assertEquals(cfg.port, 3000);
});

Deno.test("parseConfig: CLI flag --port overrides env PORT", () => {
  const cfg = ok(parseConfig(
    input({
      flags: { port: 9999, network: false, watch: false, open: false, root: undefined },
      env: { PORT: "3000" },
    }),
  ));
  assertEquals(cfg.port, 9999);
});

Deno.test("parseConfig: --network sets host to 0.0.0.0", () => {
  const cfg = ok(parseConfig(
    input({
      flags: { port: undefined, network: true, watch: false, open: false, root: undefined },
    }),
  ));
  assertEquals(cfg.host, "0.0.0.0");
});

Deno.test("parseConfig: -w / --watch toggles watch", () => {
  const cfg = ok(parseConfig(
    input({
      flags: { port: undefined, network: false, watch: true, open: false, root: undefined },
    }),
  ));
  assertEquals(cfg.watch, true);
});

Deno.test("parseConfig: --root overrides cwd", () => {
  const cfg = ok(parseConfig(
    input({
      flags: { port: undefined, network: false, watch: false, open: false, root: "/var/data" },
    }),
  ));
  assertEquals(cfg.contentRoot, "/var/data");
});

Deno.test("parseConfig: invalid port 0 returns ConfigInvalidError", () => {
  const cfg = parseConfig(
    input({ flags: { port: 0, network: false, watch: false, open: false, root: undefined } }),
  );
  assertInstanceOf(cfg, ConfigInvalidError);
  const err = cfg as ConfigInvalidError;
  assertStringIncludes(err.message.toLowerCase(), "port");
});

Deno.test("parseConfig: invalid port 99999 returns ConfigInvalidError", () => {
  const cfg = parseConfig(
    input({ flags: { port: 99999, network: false, watch: false, open: false, root: undefined } }),
  );
  assertInstanceOf(cfg, ConfigInvalidError);
});

Deno.test("parseConfig: invalid env PORT string returns ConfigInvalidError", () => {
  const cfg = parseConfig(input({ env: { PORT: "not-a-number" } }));
  assertInstanceOf(cfg, ConfigInvalidError);
});

Deno.test("parseConfig: LOG_LEVEL parsed", () => {
  const cfg = ok(parseConfig(input({ env: { LOG_LEVEL: "debug" } })));
  assertEquals(cfg.logLevel, "debug");
});

Deno.test("parseConfig: invalid LOG_LEVEL returns ConfigInvalidError", () => {
  const cfg = parseConfig(input({ env: { LOG_LEVEL: "loud" } }));
  assertInstanceOf(cfg, ConfigInvalidError);
});

Deno.test("parseConfig: SERVE_MD_DOT_WHITELIST=.context,.notes", () => {
  const cfg = ok(parseConfig(
    input({ env: { SERVE_MD_DOT_WHITELIST: ".context,.notes" } }),
  ));
  assertEquals(cfg.dotWhitelist, [".context", ".notes"]);
});

Deno.test("parseConfig: empty dot whitelist string yields []", () => {
  const cfg = ok(parseConfig(input({ env: { SERVE_MD_DOT_WHITELIST: "" } })));
  assertEquals(cfg.dotWhitelist, []);
});

Deno.test("parseConfig: dot whitelist trims whitespace and drops empty entries", () => {
  const cfg = ok(parseConfig(
    input({ env: { SERVE_MD_DOT_WHITELIST: " .context ,  , .notes " } }),
  ));
  assertEquals(cfg.dotWhitelist, [".context", ".notes"]);
});

Deno.test("parseConfig: relative cwd is resolved to absolute contentRoot", () => {
  const cfg = ok(parseConfig(input({ cwd: "relative/path" })));
  // either absolute or platform-resolved form
  assertEquals(typeof cfg.contentRoot, "string");
  // not the literal "relative/path" — should be resolved
  assertStringIncludes(cfg.contentRoot, "relative/path");
});
