export interface ChromeRelayStateTabProbe {
  id?: string;
  url?: string;
  title?: string;
}

export interface ChromeRelayStateProbe {
  version?: string;
  updatedAt?: string;
  extensionInstalled?: boolean;
  connected?: boolean;
  userGestureRequired?: boolean;
  shareRequired?: boolean;
  resumable?: boolean;
  expiresAt?: string;
  resumeRequiresUserGesture?: boolean;
  sharedTab?: ChromeRelayStateTabProbe | null;
}

export interface ChromeRelayStateValidationResult {
  ok: boolean;
  probe?: ChromeRelayStateProbe;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalTimestamp(value: unknown): value is string | undefined {
  return value === undefined || (isNonEmptyString(value) && !Number.isNaN(Date.parse(value)));
}

export function validateChromeRelayState(raw: unknown): ChromeRelayStateValidationResult {
  if (!isRecord(raw)) {
    return { ok: false, errors: ["relay state must be a JSON object"] };
  }

  const errors: string[] = [];
  const sharedTabRaw = raw.sharedTab;
  let sharedTab: ChromeRelayStateTabProbe | null | undefined;

  if (sharedTabRaw === null) {
    sharedTab = null;
  } else if (sharedTabRaw === undefined) {
    sharedTab = undefined;
  } else if (isRecord(sharedTabRaw)) {
    const id = isNonEmptyString(sharedTabRaw.id) ? sharedTabRaw.id : undefined;
    const url = isNonEmptyString(sharedTabRaw.url) ? sharedTabRaw.url : undefined;
    const title = isNonEmptyString(sharedTabRaw.title) ? sharedTabRaw.title : undefined;

    if ((sharedTabRaw.id !== undefined && id === undefined) || (sharedTabRaw.url !== undefined && url === undefined) || (sharedTabRaw.title !== undefined && title === undefined)) {
      errors.push("sharedTab fields must be non-empty strings when present");
    }
    if (!id && !url && !title) {
      errors.push("sharedTab must include at least one of id, url, or title");
    }

    sharedTab = { id, url, title };
  } else {
    errors.push("sharedTab must be an object or null");
  }

  if (raw.version !== undefined && !isNonEmptyString(raw.version)) {
    errors.push("version must be a non-empty string when present");
  }
  if (!isOptionalTimestamp(raw.updatedAt)) {
    errors.push("updatedAt must be an ISO 8601 timestamp when present");
  }
  if (!isOptionalTimestamp(raw.expiresAt)) {
    errors.push("expiresAt must be an ISO 8601 timestamp when present");
  }

  for (const key of ["extensionInstalled", "connected", "userGestureRequired", "shareRequired", "resumable", "resumeRequiresUserGesture"] as const) {
    if (!isOptionalBoolean(raw[key])) {
      errors.push(`${key} must be a boolean when present`);
    }
  }

  const extensionInstalled = typeof raw.extensionInstalled === "boolean" ? raw.extensionInstalled : undefined;
  const connected = typeof raw.connected === "boolean" ? raw.connected : undefined;
  const userGestureRequired = typeof raw.userGestureRequired === "boolean" ? raw.userGestureRequired : undefined;
  const shareRequired = typeof raw.shareRequired === "boolean" ? raw.shareRequired : undefined;
  const resumable = typeof raw.resumable === "boolean" ? raw.resumable : undefined;
  const resumeRequiresUserGesture =
    typeof raw.resumeRequiresUserGesture === "boolean" ? raw.resumeRequiresUserGesture : undefined;
  const version = isNonEmptyString(raw.version) ? raw.version : undefined;
  const updatedAt = isNonEmptyString(raw.updatedAt) ? raw.updatedAt : undefined;
  const expiresAt = isNonEmptyString(raw.expiresAt) ? raw.expiresAt : undefined;
  const hasSharedTabObject = sharedTab !== undefined && sharedTab !== null;

  if (extensionInstalled === false && connected === true) {
    errors.push("extensionInstalled=false cannot be combined with connected=true");
  }
  if (extensionInstalled === false && hasSharedTabObject) {
    errors.push("extensionInstalled=false cannot be combined with sharedTab");
  }
  if (connected === false && hasSharedTabObject) {
    errors.push("connected=false cannot be combined with sharedTab");
  }
  if (connected === false && shareRequired === true) {
    errors.push("connected=false cannot be combined with shareRequired=true");
  }
  if (connected === false && userGestureRequired === true) {
    errors.push("connected=false cannot be combined with userGestureRequired=true");
  }
  if (userGestureRequired === true && hasSharedTabObject) {
    errors.push("userGestureRequired=true cannot be combined with sharedTab");
  }
  if (shareRequired === true && hasSharedTabObject) {
    errors.push("shareRequired=true cannot be combined with sharedTab");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    probe: {
      version,
      updatedAt,
      extensionInstalled,
      connected,
      userGestureRequired,
      shareRequired,
      resumable,
      expiresAt,
      resumeRequiresUserGesture,
      sharedTab
    }
  };
}
