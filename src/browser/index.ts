import { AppError } from "../errors";
import type { BrowserAdapter, SupportedBrowser } from "../types";
import { ChromeAdapter } from "./chrome";
import { SafariAdapter } from "./safari";

export function getBrowserAdapter(browser: string): BrowserAdapter {
  if (browser === "safari") {
    return new SafariAdapter();
  }

  if (browser === "chrome") {
    return new ChromeAdapter();
  }

  throw new AppError(`Unsupported browser: ${browser}`, 400, "unsupported_browser");
}

export function normalizeBrowser(browser: string | undefined): SupportedBrowser {
  if (!browser || browser === "safari") {
    return "safari";
  }

  if (browser === "chrome" || browser === "chromium") {
    return "chrome";
  }

  throw new AppError(`Unsupported browser: ${browser}`, 400, "unsupported_browser");
}
