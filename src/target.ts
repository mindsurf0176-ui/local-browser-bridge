import { AppError } from "./errors";
import type { BrowserTabTarget, TabMetadata } from "./types";

function parseIndex(value: string | number | undefined, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError(`${fieldName} must be a positive integer.`, 400, "invalid_target");
  }

  return parsed;
}

function parseNonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildTabTarget(input: {
  windowIndex?: string | number;
  tabIndex?: string | number;
  signature?: string;
  url?: string;
  title?: string;
} = {}): BrowserTabTarget {
  const windowIndex = parseIndex(input.windowIndex, "windowIndex");
  const tabIndex = parseIndex(input.tabIndex, "tabIndex");
  const signature = parseNonEmpty(input.signature);
  const url = parseNonEmpty(input.url);
  const title = parseNonEmpty(input.title);

  if (signature) {
    return {
      type: "signature",
      signature,
      url,
      title,
      lastKnownWindowIndex: windowIndex,
      lastKnownTabIndex: tabIndex
    };
  }

  if (windowIndex === undefined && tabIndex === undefined) {
    return { type: "front" };
  }

  if (windowIndex === undefined || tabIndex === undefined) {
    throw new AppError(
      "windowIndex and tabIndex must be provided together for an explicit tab target.",
      400,
      "invalid_target"
    );
  }

  return {
    type: "indexed",
    windowIndex,
    tabIndex
  };
}

export function buildSignatureTargetFromTab(tab: TabMetadata): BrowserTabTarget {
  return {
    type: "signature",
    signature: tab.identity.signature,
    url: tab.url,
    title: tab.title,
    lastKnownWindowIndex: tab.windowIndex,
    lastKnownTabIndex: tab.tabIndex,
    native: tab.identity.native
  };
}
