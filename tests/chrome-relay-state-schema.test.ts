import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { validateChromeRelayState } from "../src/chrome-relay-state";

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

test("chrome relay schema artifact stays present and documented", async () => {
  const root = process.cwd();
  const schema = await readJson<{
    $schema: string;
    $id: string;
    title: string;
    properties: Record<string, unknown>;
  }>(resolve(root, "schema", "chrome-relay-state.schema.json"));
  const producerDoc = await readFile(resolve(root, "docs", "chrome-relay-producer-contract.md"), "utf8");
  const readme = await readFile(resolve(root, "README.md"), "utf8");

  assert.match(schema.$schema, /json-schema.org/);
  assert.match(schema.$id, /chrome-relay-state\.schema\.json$/);
  assert.equal(schema.title, "Local Browser Bridge Chrome Relay State");
  assert.ok(schema.properties.sharedTab);
  assert.match(producerDoc, /schema\/chrome-relay-state\.schema\.json/);
  assert.match(readme, /schema\/chrome-relay-state\.schema\.json/);
});

test("chrome relay example fixture validates as a ready shared-tab probe", async () => {
  const root = process.cwd();
  const example = await readJson(resolve(root, "examples", "chrome-relay-state.example.json"));
  const result = validateChromeRelayState(example);

  assert.equal(result.ok, true);
  assert.equal(result.probe?.version, "1.1.0");
  assert.equal(result.probe?.connected, true);
  assert.equal(result.probe?.sharedTab?.id, "tab-123");
  assert.equal(result.probe?.sharedTab?.url, "https://example.com/shared");
});

test("chrome relay validation rejects malformed or contradictory producer payloads", () => {
  const cases: Array<{ name: string; payload: unknown; expected: RegExp }> = [
    {
      name: "shared tab must carry at least one identity field",
      payload: { extensionInstalled: true, connected: true, sharedTab: {} },
      expected: /sharedTab must include at least one of id, url, or title/
    },
    {
      name: "gesture required cannot also expose a shared tab",
      payload: {
        extensionInstalled: true,
        connected: true,
        userGestureRequired: true,
        sharedTab: { id: "tab-1" }
      },
      expected: /userGestureRequired=true cannot be combined with sharedTab/
    },
    {
      name: "share required cannot also expose a shared tab",
      payload: {
        extensionInstalled: true,
        connected: true,
        shareRequired: true,
        sharedTab: { url: "https://example.com" }
      },
      expected: /shareRequired=true cannot be combined with sharedTab/
    },
    {
      name: "missing extension cannot report connected",
      payload: {
        extensionInstalled: false,
        connected: true
      },
      expected: /extensionInstalled=false cannot be combined with connected=true/
    },
    {
      name: "timestamps must be parseable",
      payload: {
        extensionInstalled: true,
        connected: true,
        updatedAt: "not-a-date",
        sharedTab: { id: "tab-1" }
      },
      expected: /updatedAt must be an ISO 8601 timestamp/
    },
    {
      name: "sharedTab must be object or null",
      payload: {
        extensionInstalled: true,
        connected: true,
        sharedTab: "tab-1"
      },
      expected: /sharedTab must be an object or null/
    }
  ];

  for (const testCase of cases) {
    const result = validateChromeRelayState(testCase.payload);
    assert.equal(result.ok, false, testCase.name);
    assert.match(result.errors.join(" | "), testCase.expected, testCase.name);
  }
});
