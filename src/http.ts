import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AppError, toErrorPayload } from "./errors";
import { AttachService } from "./service/attach-service";
import { normalizeBrowser } from "./browser";
import { buildTabTarget } from "./target";

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

function requireString(value: unknown, fieldName: string, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(`${fieldName} is required.`, 400, code);
  }

  return value.trim();
}

export function createApiServer(service: AttachService) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const method = request.method ?? "GET";
      const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)$/);
      const resumeMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/resume$/);
      const activateMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/activate$/);
      const navigateMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/navigate$/);
      const sessionScreenshotMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/screenshot$/);

      if (method === "GET" && url.pathname === "/health") {
        writeJson(response, 200, { ok: true });
        return;
      }

      if (method === "GET" && url.pathname === "/v1/diagnostics") {
        const browser = normalizeBrowser(url.searchParams.get("browser") ?? undefined);
        const diagnostics = await service.diagnostics(browser);
        writeJson(response, 200, { diagnostics });
        return;
      }

      if (method === "GET" && url.pathname === "/v1/capabilities") {
        const browserFlag = url.searchParams.get("browser") ?? undefined;
        const browser = browserFlag ? normalizeBrowser(browserFlag) : undefined;
        const capabilities = service.getCapabilities(browser);
        writeJson(response, 200, { capabilities });
        return;
      }

      if (method === "GET" && url.pathname === "/v1/front-tab") {
        const browser = normalizeBrowser(url.searchParams.get("browser") ?? undefined);
        const frontTab = await service.inspectFrontTab(browser);
        writeJson(response, 200, { frontTab });
        return;
      }

      if (method === "GET" && url.pathname === "/v1/tab") {
        const browser = normalizeBrowser(url.searchParams.get("browser") ?? undefined);
        const target = buildTabTarget({
          windowIndex: url.searchParams.get("windowIndex") ?? undefined,
          tabIndex: url.searchParams.get("tabIndex") ?? undefined,
          signature: url.searchParams.get("signature") ?? undefined,
          url: url.searchParams.get("url") ?? undefined,
          title: url.searchParams.get("title") ?? undefined
        });
        const tab = await service.inspectTab(browser, target);
        writeJson(response, 200, { tab });
        return;
      }

      if (method === "GET" && url.pathname === "/v1/tabs") {
        const browser = normalizeBrowser(url.searchParams.get("browser") ?? undefined);
        const tabs = await service.listTabs(browser);
        writeJson(response, 200, { tabs });
        return;
      }

      if (method === "POST" && url.pathname === "/v1/attach") {
        const body = (await readJsonBody(request)) as {
          browser?: string;
          target?: { windowIndex?: number; tabIndex?: number; signature?: string; url?: string; title?: string };
          attach?: { mode?: string };
        };
        const browser = normalizeBrowser(body.browser);
        const target = buildTabTarget(body.target);
        const attachMode = body.attach?.mode;
        if (attachMode !== undefined && attachMode !== "direct" && attachMode !== "relay") {
          throw new AppError("attach.mode must be direct or relay.", 400, "invalid_attach_mode");
        }
        const session = await service.attach(browser, {
          target,
          attach: { mode: attachMode }
        });
        writeJson(response, 201, { session });
        return;
      }

      if (method === "POST" && url.pathname === "/v1/activate") {
        const body = (await readJsonBody(request)) as {
          browser?: string;
          target?: { windowIndex?: number; tabIndex?: number; signature?: string; url?: string; title?: string };
        };
        const browser = normalizeBrowser(body.browser);
        const target = buildTabTarget(body.target);
        const activation = await service.activate(browser, target);
        writeJson(response, 201, { activation });
        return;
      }

      if (method === "POST" && url.pathname === "/v1/navigate") {
        const body = (await readJsonBody(request)) as {
          browser?: string;
          url?: string;
          target?: { windowIndex?: number; tabIndex?: number; signature?: string; url?: string; title?: string };
        };
        const browser = normalizeBrowser(body.browser);
        const target = buildTabTarget(body.target);
        const navigation = await service.navigate(browser, target, {
          url: requireString(body.url, "url", "missing_url")
        });
        writeJson(response, 201, { navigation });
        return;
      }

      if (method === "POST" && url.pathname === "/v1/screenshot") {
        const body = (await readJsonBody(request)) as {
          browser?: string;
          outputPath?: string;
          target?: { windowIndex?: number; tabIndex?: number; signature?: string; url?: string; title?: string };
        };
        const browser = normalizeBrowser(body.browser);
        const target = buildTabTarget(body.target);
        const screenshot = await service.screenshot(browser, target, { outputPath: body.outputPath });
        writeJson(response, 201, { screenshot });
        return;
      }

      if (method === "GET" && url.pathname === "/v1/sessions") {
        const sessions = await service.listSessions();
        writeJson(response, 200, { sessions });
        return;
      }

      if (method === "GET" && sessionMatch) {
        const session = await service.getSession(decodeURIComponent(sessionMatch[1]));
        writeJson(response, 200, { session });
        return;
      }

      if (method === "POST" && resumeMatch) {
        const resumedSession = await service.resumeSession(decodeURIComponent(resumeMatch[1]));
        writeJson(response, 200, { resumedSession });
        return;
      }

      if (method === "POST" && activateMatch) {
        const sessionActivation = await service.activateSession(decodeURIComponent(activateMatch[1]));
        writeJson(response, 201, { sessionActivation });
        return;
      }

      if (method === "POST" && navigateMatch) {
        const body = (await readJsonBody(request)) as { url?: string };
        const sessionNavigation = await service.navigateSession(
          decodeURIComponent(navigateMatch[1]),
          { url: requireString(body.url, "url", "missing_url") }
        );
        writeJson(response, 201, { sessionNavigation });
        return;
      }

      if (method === "POST" && sessionScreenshotMatch) {
        const body = (await readJsonBody(request)) as { outputPath?: string };
        const sessionScreenshot = await service.screenshotSession(
          decodeURIComponent(sessionScreenshotMatch[1]),
          { outputPath: body.outputPath }
        );
        writeJson(response, 201, { sessionScreenshot });
        return;
      }

      writeJson(response, 404, { error: { code: "not_found", message: "Route not found.", statusCode: 404 } });
    } catch (error) {
      const { statusCode, payload } = toErrorPayload(error);
      writeJson(response, statusCode, payload);
    }
  });
}
