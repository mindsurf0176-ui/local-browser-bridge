import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

type PackageJson = {
  main?: string;
  types?: string;
  files?: string[];
  scripts?: Record<string, string>;
  exports?: Record<string, string | { types?: string; require?: string; default?: string }>;
};

test("package metadata exposes built JS and declarations for git consumption", () => {
  const root = process.cwd();
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as PackageJson;

  assert.equal(packageJson.main, "./dist/src/index.js");
  assert.equal(packageJson.types, "./dist/src/index.d.ts");
  assert.equal(packageJson.scripts?.prepare, "npm run build");
  assert.deepEqual(packageJson.files, ["dist/**/*", "README.md"]);

  const rootExport =
    typeof packageJson.exports?.["."] === "string" ? undefined : packageJson.exports?.["."];
  const uxHelperExport =
    typeof packageJson.exports?.["./browser-attach-ux-helper"] === "string"
      ? undefined
      : packageJson.exports?.["./browser-attach-ux-helper"];
  const codexExport =
    typeof packageJson.exports?.["./codex"] === "string"
      ? undefined
      : packageJson.exports?.["./codex"];
  const relayHelperExport =
    typeof packageJson.exports?.["./chrome-relay-error-helper"] === "string"
      ? undefined
      : packageJson.exports?.["./chrome-relay-error-helper"];

  assert.equal(rootExport?.require, "./dist/src/index.js");
  assert.equal(rootExport?.types, "./dist/src/index.d.ts");
  assert.equal(codexExport?.types, "./dist/src/codex.d.ts");
  assert.equal(uxHelperExport?.types, "./dist/src/browser-attach-ux-helper.d.ts");
  assert.equal(relayHelperExport?.types, "./dist/src/chrome-relay-error-helper.d.ts");

  assert.ok(existsSync(resolve(root, "dist", "src", "index.js")));
  assert.ok(existsSync(resolve(root, "dist", "src", "index.d.ts")));
  assert.ok(existsSync(resolve(root, "dist", "src", "codex.d.ts")));
  assert.ok(existsSync(resolve(root, "dist", "src", "browser-attach-ux-helper.d.ts")));
  assert.ok(existsSync(resolve(root, "dist", "src", "chrome-relay-error-helper.d.ts")));
});

test("package root resolves the stable helper surface from built output", () => {
  const publicEntry = require(process.cwd()) as typeof import("../src");

  assert.equal(typeof publicEntry.connectViaBridge, "function");
  assert.equal(typeof publicEntry.createBridgeAdapter, "function");
  assert.equal(typeof publicEntry.createHttpBridgeAdapter, "function");
  assert.equal(typeof publicEntry.createCliBridgeAdapter, "function");
  assert.equal(typeof publicEntry.normalizeCodexRoute, "function");
  assert.equal(typeof publicEntry.connectCodexViaCli, "function");
  assert.equal(typeof publicEntry.connectCodexViaHttp, "function");
  assert.equal(typeof publicEntry.interpretBrowserAttachUxFromSession, "function");
  assert.equal(typeof publicEntry.interpretChromeRelayFailure, "function");
});
