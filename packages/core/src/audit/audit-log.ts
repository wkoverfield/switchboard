import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PathResolutionOptions } from "../config/paths.js";

export type AuditAction = "profile_test" | "tool_call" | "approval_elicitation";
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
  mandateId?: string;
  mandateUid?: string;
  repoPath?: string;
  worktreePath?: string;
  branch?: string;
  approvalRequestId?: string;
  approvalGateId?: string;
  approvalGatePattern?: string;
  approvalDecision?: "approved" | "denied" | "declined" | "cancelled" | "failed";
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
  mandateId?: string;
}

export interface SafeAuditLogOptions {
  onError?: (error: unknown) => void;
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

export async function safeAuditLog(
  logger: AuditLogger,
  entry: Omit<AuditLogEntry, "version" | "timestamp">,
  options: SafeAuditLogOptions = {}
): Promise<void> {
  try {
    await logger.log(entry);
  } catch (error) {
    options.onError?.(error);
  }
}

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
    .flatMap((line) => parseAuditLogLine(line))
    .filter((entry) =>
      options.mandateId ? entry.mandateId === options.mandateId : true
    );

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
    .replace(/https?:\/\/([^/\s:@]+):([^/\s@]+)@/gi, "https://[redacted]@")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[redacted]")
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{8,})\b/g, "[redacted]")
    .replace(/\b(xox[baprs]-[A-Za-z0-9-]{8,})\b/g, "[redacted]")
    .replace(
      /\b(authorization\s*:\s*bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
      "$1 [redacted]"
    )
    .replace(
      /"((?:api[_-]?key|token|secret|password))"\s*:\s*"[^"]+"/gi,
      '"$1":"[redacted]"'
    )
    .replace(
      /\b(token|secret|password|api[_-]?key)=\S+/gi,
      "$1=[redacted]"
    );
}

function parseAuditLogLine(line: string): AuditLogEntry[] {
  try {
    return [JSON.parse(line) as AuditLogEntry];
  } catch {
    return [];
  }
}
