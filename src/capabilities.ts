import packageJson from "../package.json";
import type { BridgeCapabilitiesContract, BrowserCapabilityDescriptor, SupportedBrowser } from "./types";

const CONTRACT_SCHEMA_PATH = "schema/capabilities.schema.json";
const PRODUCT_MANIFESTO_PATH = "docs/product-direction.md";

function buildBrowserCapabilities(browser: SupportedBrowser): BrowserCapabilityDescriptor {
  if (browser === "safari") {
    return {
      kind: "safari-actionable",
      browser: "safari",
      adapter: "SafariAdapter",
      available: true,
      maturity: "primary",
      platforms: ["macos"],
      bridge: {
        browserNative: false,
        implementation: "macos Apple Events via osascript/JXA plus screencapture"
      },
      targeting: {
        modes: ["front", "indexed", "signature"],
        sessionResumeStrategies: ["front", "indexed", "signature", "url_title", "url", "last_known_index"]
      },
      operations: {
        capabilities: true,
        diagnostics: true,
        inspectFrontTab: true,
        inspectTab: true,
        listTabs: true,
        attach: true,
        resumeSession: true,
        activate: true,
        navigate: true,
        screenshot: true
      },
      attachModes: [
        {
          mode: "direct",
          source: "user-browser",
          scope: "browser",
          supported: true,
          readiness: "ready"
        }
      ],
      transports: {
        cli: true,
        http: true
      },
      constraints: [
        "Safari automation depends on macOS Apple Events permissions.",
        "Screenshots depend on macOS screen recording permissions.",
        "Activation, navigation, and screenshot capture visibly focus Safari."
      ]
    };
  }

  if (browser === "chrome") {
    return {
      kind: "chrome-readonly",
      browser: "chrome",
      adapter: "ChromeAdapter",
      available: true,
      maturity: "experimental-readonly",
      platforms: ["macos"],
      bridge: {
        browserNative: true,
        implementation: "Chrome/Chromium inspection over an existing local DevTools endpoint; read-only in v1"
      },
      targeting: {
        modes: ["front", "indexed", "signature"],
        sessionResumeStrategies: [
          "front",
          "indexed",
          "native_identity",
          "signature",
          "url_title",
          "url",
          "last_known_index"
        ]
      },
      operations: {
        capabilities: true,
        diagnostics: true,
        inspectFrontTab: true,
        inspectTab: true,
        listTabs: true,
        attach: true,
        resumeSession: true,
        activate: false,
        navigate: false,
        screenshot: false
      },
      attachModes: [
        {
          mode: "direct",
          source: "user-browser",
          scope: "browser",
          supported: true,
          readiness: "degraded"
        },
        {
          mode: "relay",
          source: "extension-relay",
          scope: "tab",
          supported: true,
          readiness: "unavailable"
        }
      ],
      transports: {
        cli: true,
        http: true
      },
      constraints: [
        "Chrome/Chromium inspection currently requires an already-running local DevTools HTTP endpoint.",
        "This adapter is read-only in this phase: attach and saved-session resume work for inspectable targets, but activate/navigate/screenshot do not.",
        "If no debugging endpoint is discoverable, inspection returns a clear unavailable error and diagnostics enumerate the attempted sources.",
        "Chrome attach-mode metadata distinguishes direct user-browser attach from future extension relay attach without changing the current read-only behavior model."
      ]
    };
  }

  throw new Error(`Unsupported browser capability descriptor: ${browser}`);
}

export function getBrowserCapabilityDescriptor(browser: SupportedBrowser): BrowserCapabilityDescriptor {
  return buildBrowserCapabilities(browser);
}

export function getBridgeCapabilities(browser?: SupportedBrowser): BridgeCapabilitiesContract {
  const browsers = browser
    ? [getBrowserCapabilityDescriptor(browser)]
    : [getBrowserCapabilityDescriptor("safari"), getBrowserCapabilityDescriptor("chrome")];

  return {
    schemaVersion: 1,
    schema: {
      path: CONTRACT_SCHEMA_PATH,
      version: "1.0.0"
    },
    generatedAt: new Date().toISOString(),
    product: {
      name: packageJson.name,
      displayName: "local-browser-bridge",
      version: packageJson.version,
      summary: "Reusable, agent-agnostic local browser bridge with honest capability signaling. Safari is actionable; Chrome/Chromium is read-only in v1.",
      direction: {
        localOnly: true,
        agentAgnostic: true,
        browserStrategy: "safari-first",
        architectureStrategy: "bridge-first"
      },
      manifestoPath: PRODUCT_MANIFESTO_PATH
    },
    transports: {
      cli: {
        available: true,
        format: "json",
        binary: "local-browser-bridge",
        aliasBinaries: ["safari-attach-tool"],
        command: "local-browser-bridge capabilities [--browser safari|chrome]"
      },
      http: {
        available: true,
        format: "json",
        baseUrl: "http://127.0.0.1:3000",
        capabilitiesPath: "/v1/capabilities"
      }
    },
    targeting: {
      modes: ["front", "indexed", "signature"],
      sessionResumeStrategies: [
        "front",
        "indexed",
        "native_identity",
        "signature",
        "url_title",
        "url",
        "last_known_index"
      ]
    },
    browsers
  };
}
