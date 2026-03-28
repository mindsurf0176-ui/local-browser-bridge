import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { validateChromeRelayState } from "../src/chrome-relay-state";
import {
  buildChromeRelayFixtureState,
  writeChromeRelayFixtureState,
  resolveChromeRelayStateOutputPath,
  CHROME_RELAY_STATE_PATH_ENV,
  type ChromeRelayFixtureFlow
} from "../src/chrome-relay-helper";
import { runChromeRelayHelperCli } from "../src/chrome-relay-helper-cli";

async function withCapturedStreams(run: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);

  (process.stdout.write as typeof process.stdout.write) = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;

  (process.stderr.write as typeof process.stderr.write) = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stderr.write;

  try {
    await run();
    return { stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

test("chrome relay helper fixture flows validate and preserve truthful relay semantics", () => {
  const flows: ChromeRelayFixtureFlow[] = [
    "extension-missing",
    "disconnected",
    "click-required",
    "share-required",
    "shared-tab",
    "expired-share",
    "clear-shared-tab"
  ];

  for (const flow of flows) {
    const state = buildChromeRelayFixtureState({ flow });
    const validation = validateChromeRelayState(state);
    assert.equal(validation.ok, true, flow);
    assert.equal(validation.probe?.version, state.version, flow);
    assert.equal(validation.probe?.updatedAt, state.updatedAt, flow);
  }

  const sharedTab = buildChromeRelayFixtureState({ flow: "shared-tab" });
  assert.equal(sharedTab.connected, true);
  assert.equal(sharedTab.shareRequired, false);
  assert.ok(sharedTab.sharedTab?.id);
  assert.ok(sharedTab.expiresAt);

  const expiredShare = buildChromeRelayFixtureState({ flow: "expired-share" });
  assert.ok(expiredShare.sharedTab?.id);
  assert.ok(expiredShare.expiresAt);
  assert.equal(Date.parse(expiredShare.expiresAt ?? ""), Date.parse(expiredShare.expiresAt ?? ""));
  assert.ok(Date.parse(expiredShare.expiresAt ?? "") <= Date.now());
  assert.equal(expiredShare.resumable, false);
  assert.equal(expiredShare.resumeRequiresUserGesture, true);

  const cleared = buildChromeRelayFixtureState({ flow: "clear-shared-tab" });
  assert.equal(cleared.connected, true);
  assert.equal(cleared.sharedTab, null);
});

test("chrome relay helper writes full snapshots to the configured path and overwrites atomically", async () => {
  const baseDir = resolve(process.cwd(), ".tmp-tests", "relay-helper-write");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(baseDir, { recursive: true });

  const outputPath = resolve(baseDir, "chrome-relay-state.json");
  await writeFile(outputPath, '{"stale":true}', "utf8");

  const first = await writeChromeRelayFixtureState({
    flow: "shared-tab",
    outputPath,
    tabId: "relay-1",
    url: "https://example.com/one",
    title: "One"
  });
  const second = await writeChromeRelayFixtureState({
    flow: "clear-shared-tab",
    outputPath
  });

  assert.equal(first.path, outputPath);
  assert.equal(second.path, outputPath);

  const persisted = JSON.parse(await readFile(outputPath, "utf8")) as { sharedTab?: null | { id?: string } };
  assert.equal(persisted.sharedTab, null);

  const dirEntries = await readdir(baseDir);
  assert.deepEqual(dirEntries.sort(), ["chrome-relay-state.json"]);
});

test("chrome relay helper CLI writes a documented flow and emits the final snapshot", async () => {
  const baseDir = resolve(process.cwd(), ".tmp-tests", "relay-helper-cli");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(baseDir, { recursive: true });

  const outputPath = resolve(baseDir, "chrome-relay-state.json");
  const captured = await withCapturedStreams(async () => {
    await runChromeRelayHelperCli([
      "shared-tab",
      "--output",
      outputPath,
      "--tab-id",
      "relay-42",
      "--title",
      "Shared Docs",
      "--url",
      "https://example.com/docs",
      "--resumable",
      "true",
      "--resume-requires-user-gesture",
      "false"
    ]);
  });

  assert.equal(captured.stderr, "");
  const payload = JSON.parse(captured.stdout) as {
    ok: boolean;
    flow: string;
    path: string;
    state: { sharedTab?: { id?: string; title?: string; url?: string } };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.flow, "shared-tab");
  assert.equal(payload.path, outputPath);
  assert.equal(payload.state.sharedTab?.id, "relay-42");
  assert.equal(payload.state.sharedTab?.title, "Shared Docs");
  assert.equal(payload.state.sharedTab?.url, "https://example.com/docs");

  const persisted = JSON.parse(await readFile(outputPath, "utf8")) as { sharedTab?: { url?: string } };
  assert.equal(persisted.sharedTab?.url, "https://example.com/docs");
});

test("chrome relay helper output path resolution honors explicit path then env then conventional default", () => {
  const explicit = resolve(process.cwd(), ".tmp-tests", "explicit.json");
  assert.equal(resolveChromeRelayStateOutputPath(explicit), explicit);

  const previous = process.env[CHROME_RELAY_STATE_PATH_ENV];
  process.env[CHROME_RELAY_STATE_PATH_ENV] = resolve(process.cwd(), ".tmp-tests", "env.json");

  try {
    assert.equal(resolveChromeRelayStateOutputPath(), resolve(process.cwd(), ".tmp-tests", "env.json"));
  } finally {
    if (previous === undefined) {
      delete process.env[CHROME_RELAY_STATE_PATH_ENV];
    } else {
      process.env[CHROME_RELAY_STATE_PATH_ENV] = previous;
    }
  }

  assert.match(resolveChromeRelayStateOutputPath(), /\.local-browser-bridge\/chrome-relay-state\.json$/);
});
