import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { normalizeAttachmentSession } from "../session-metadata";
import type { AttachmentSession } from "../types";

interface SessionStoreOptions {
  filePath?: string;
}

export class SessionStore {
  private readonly filePath: string;

  constructor(options: SessionStoreOptions = {}) {
    this.filePath = options.filePath ?? resolve(process.cwd(), ".data", "sessions.json");
  }

  async list(): Promise<AttachmentSession[]> {
    await this.ensureFile();
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as AttachmentSession[];
    return parsed.map(normalizeAttachmentSession).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<AttachmentSession | undefined> {
    const sessions = await this.list();
    return sessions.find((session) => session.id === id);
  }

  async create(session: AttachmentSession): Promise<AttachmentSession> {
    const sessions = await this.list();
    const normalizedSession = normalizeAttachmentSession(session);
    sessions.unshift(normalizedSession);
    await writeFile(this.filePath, JSON.stringify(sessions, null, 2) + "\n", "utf8");
    return normalizedSession;
  }

  async update(session: AttachmentSession): Promise<AttachmentSession> {
    const sessions = await this.list();
    const normalizedSession = normalizeAttachmentSession(session);
    const index = sessions.findIndex((candidate) => candidate.id === normalizedSession.id);
    if (index === -1) {
      sessions.unshift(normalizedSession);
    } else {
      sessions[index] = normalizedSession;
    }

    await writeFile(this.filePath, JSON.stringify(sessions, null, 2) + "\n", "utf8");
    return normalizedSession;
  }

  private async ensureFile(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await writeFile(this.filePath, "[]\n", "utf8");
    }
  }
}
