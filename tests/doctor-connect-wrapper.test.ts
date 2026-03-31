import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("doctor/connect wrapper example surfaces blocked relay prompts", async () => {
  const wrapperPath = resolve(process.cwd(), "examples/clients/doctor-connect-wrapper.ts");
  const stubPath = resolve(process.cwd(), "dist/tests/fixtures/doctor-connect-cli-stub.js");
  const result = await execFileAsync(process.execPath, ["--experimental-strip-types", wrapperPath, "chrome-relay"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOCAL_BROWSER_BRIDGE_BIN: process.execPath,
      LOCAL_BROWSER_BRIDGE_CLI_PATH: stubPath
    }
  });

  const payload = JSON.parse(result.stdout) as {
    result: {
      ok: boolean;
      stage: string;
      outcome: string;
      status: string;
      category: string;
      reason?: { code?: string; message?: string };
      route: string;
      label: string;
      prompt: string;
      nextStep: { action: string };
      readOnly: boolean;
      sharedTabScoped: boolean;
    };
  };

  assert.equal(payload.result.ok, false);
  assert.equal(payload.result.stage, "doctor");
  assert.equal(payload.result.outcome, "blocked");
  assert.equal(payload.result.status, "blocked");
  assert.equal(payload.result.category, "route-blocked");
  assert.equal(payload.result.reason?.code, "relay_share_required");
  assert.equal(payload.result.route, "chrome-relay");
  assert.equal(payload.result.label, "Chrome (shared tab, read-only)");
  assert.match(payload.result.prompt, /Share the tab first/i);
  assert.equal(payload.result.nextStep.action, "fix-blocker");
  assert.equal(payload.result.readOnly, true);
  assert.equal(payload.result.sharedTabScoped, true);
});

test("doctor/connect wrapper example returns concise session results for Safari", async () => {
  const wrapperPath = resolve(process.cwd(), "examples/clients/doctor-connect-wrapper.ts");
  const stubPath = resolve(process.cwd(), "dist/tests/fixtures/doctor-connect-cli-stub.js");
  const result = await execFileAsync(process.execPath, ["--experimental-strip-types", wrapperPath, "safari"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOCAL_BROWSER_BRIDGE_BIN: process.execPath,
      LOCAL_BROWSER_BRIDGE_CLI_PATH: stubPath
    }
  });

  const payload = JSON.parse(result.stdout) as {
    wrapper: string;
    result: {
      ok: boolean;
      stage: string;
      outcome: string;
      status: string;
      category: string;
      route: string;
      label: string;
      readOnly: boolean;
      session?: { id: string; kind: string; canAct: boolean; suggestedActions: string[] };
    };
  };

  assert.equal(payload.wrapper, "doctor-connect");
  assert.equal(payload.result.ok, true);
  assert.equal(payload.result.stage, "connect");
  assert.equal(payload.result.outcome, "success");
  assert.equal(payload.result.status, "connected");
  assert.equal(payload.result.category, "session-connected");
  assert.equal(payload.result.route, "safari");
  assert.equal(payload.result.label, "Safari (actionable)");
  assert.equal(payload.result.readOnly, false);
  assert.equal(payload.result.session?.id, "session-safari-demo");
  assert.equal(payload.result.session?.kind, "safari-actionable");
  assert.equal(payload.result.session?.canAct, true);
  assert.deepEqual(payload.result.session?.suggestedActions, ["resume", "activate", "navigate", "screenshot"]);
});
