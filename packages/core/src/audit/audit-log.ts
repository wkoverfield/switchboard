import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PathResolutionOptions } from "../config/paths.js";

export type AuditAction = "profile_test" | "tool_call";
export type AuditStatus = "ok" | "error";

export interface AuditLogEntry {
  version: 1;
  timestamp: string;
  action: AuditAction;
  status: AuditStatus;
  profileName?: string;
  namespace?: string;
  toolName?: string;
  upstreamName?: string;
  durationMs?: number;
  error?: string;
}

export interface AuditLogger {
  log(entry: Omit<AuditLogEntry, "version" | "timestamp">): Promise<void>;
}

export interface JsonlAuditLoggerOptions extends PathResolutionOptions {
  path?: string;
  now?: () => Date;
}

export interface ReadAuditLogOptions {
  path?: string;
  limit?: number;
}

export function resolveAuditLogPath(
  options: PathResolutionOptions = {}
): string {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const stateRoot = env.XDG_STATE_HOME
    ? resolve(env.XDG_STATE_HOME)
    : join(home, ".local", "state");

  return join(stateRoot, "switchboard", "logs", "switchboard.jsonl");
}

export function createJsonlAuditLogger(
  options: JsonlAuditLoggerOptions = {}
): AuditLogger {
  const path = options.path ?? resolveAuditLogPath(options);
  const now = options.now ?? (() => new Date());

  return {
    async log(entry) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const completeEntry: AuditLogEntry = {
        version: 1,
        timestamp: now().toISOString(),
        ...redactAuditEntry(entry)
      };

      await appendFile(path, `${JSON.stringify(completeEntry)}\n`, {
        mode: 0o600
      });
      await chmod(path, 0o600);
    }
  };
}

export const noopAuditLogger: AuditLogger = {
  async log() {
    // Intentionally empty for tests and embeddings that do not want disk writes.
  }
};

export async function readAuditLogEntries(
  options: ReadAuditLogOptions = {}
): Promise<AuditLogEntry[]> {
  const path = options.path ?? resolveAuditLogPath();
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return "";
    }

    throw error;
  });
  const entries = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AuditLogEntry);

  if (options.limit === undefined) {
    return entries;
  }

  return entries.slice(Math.max(entries.length - options.limit, 0));
}

function redactAuditEntry(
  entry: Omit<AuditLogEntry, "version" | "timestamp">
): Omit<AuditLogEntry, "version" | "timestamp"> {
  if (!entry.error) {
    return entry;
  }

  return { ...entry, error: redactSecretLikeText(entry.error) };
}

function redactSecretLikeText(value: string): string {
  return value
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "[redacted]")
    .replace(/(token|secret|password|api[_-]?key)=\S+/gi, "$1=[redacted]");
}
