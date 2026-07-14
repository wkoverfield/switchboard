import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PathResolutionOptions } from "../config/paths.js";

export type AuditAction =
  | "profile_test"
  | "tool_call"
  | "approval_elicitation"
  | "command_run";
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
  command?: string;
  args?: string[];
  cwd?: string;
  envKeys?: string[];
  exitCode?: number | null;
  stdoutSnippet?: string;
  stderrSnippet?: string;
  durationMs?: number;
  error?: string;
  // Absolute 0-based line position in the log, part of the hashed content. A
  // head marker records the latest seq so `verifyAuditLog` can detect
  // tail-truncation: a truncated log ends at a lower seq than the head records.
  seq?: number;
  prevHash?: string;
  hash?: string;
}

// The tip of the chain, recorded outside the append-only log so truncation is
// detectable. Written next to the log under the same lock, replaced
// atomically. If an attacker can truncate the log they can also delete this
// marker, but then verification reports "cannot confirm completeness" instead
// of a false "chain OK": the marker makes truncation loud, not impossible.
export interface AuditLogHead {
  seq: number;
  hash: string;
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

export interface VerifyAuditLogOptions {
  path?: string;
}

export interface AuditLogVerificationFailure {
  lineNumber: number;
  reason: string;
}

export interface AuditLogVerification {
  ok: boolean;
  path: string;
  totalLines: number;
  chainedEntries: number;
  legacyEntries: number;
  // The head marker as read from disk (null when absent, e.g. a legacy log or
  // a deleted marker). `expectedEntries` is head.seq + 1 when a marker exists.
  headMarker: AuditLogHead | null;
  expectedEntries: number | null;
  failures: AuditLogVerificationFailure[];
}

export const auditLogChainGenesis = "genesis";

const auditLogLockTimeoutMs = 5_000;
const auditLogStaleLockMs = 30_000;
const auditLogTailReadBytes = 64 * 1024;

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

export function computeAuditLogEntryHash(
  entry: Omit<AuditLogEntry, "hash">
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(entry))
    .digest("hex");
  return `sha256:${digest}`;
}

export function createJsonlAuditLogger(
  options: JsonlAuditLoggerOptions = {}
): AuditLogger {
  const path = options.path ?? resolveAuditLogPath(options);
  const now = options.now ?? (() => new Date());

  return {
    async log(entry) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await withAuditLogLock(path, async () => {
        const prevHash = await readChainTipHash(path);
        const seq = await nextAuditLogSeq(path);
        const unhashedEntry: Omit<AuditLogEntry, "hash"> = {
          version: 1,
          timestamp: now().toISOString(),
          ...redactAuditEntry(entry),
          seq,
          prevHash
        };
        const hash = computeAuditLogEntryHash(unhashedEntry);
        const completeEntry: AuditLogEntry = { ...unhashedEntry, hash };

        await appendFile(path, `${JSON.stringify(completeEntry)}\n`, {
          mode: 0o600
        });
        await chmod(path, 0o600);
        // Update the head marker last: if this write fails after the append,
        // verification sees "more entries than the head records" and flags it,
        // rather than silently accepting a shorter-than-real chain.
        await writeAuditLogHead(path, { seq, hash });
      });
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
    // A failed audit write must not abort the routed call, but it must not be
    // silent either: an attacker who can make audit writes fail should not get
    // unlogged actions for free. Callers can pass onError to route it; the
    // default is a loud stderr warning (stdout is the MCP protocol channel).
    if (options.onError) {
      options.onError(error);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `switchboard: WARNING audit log write failed, action not recorded: ${message}\n`
    );
  }
}

export async function readAuditLogEntries(
  options: ReadAuditLogOptions = {}
): Promise<AuditLogEntry[]> {
  const path = options.path ?? resolveAuditLogPath();
  const raw = await readAuditLogFile(path);
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

export async function verifyAuditLog(
  options: VerifyAuditLogOptions = {}
): Promise<AuditLogVerification> {
  const path = options.path ?? resolveAuditLogPath();
  const raw = await readAuditLogFile(path);
  const lines = raw.split("\n").filter(Boolean);
  const failures: AuditLogVerificationFailure[] = [];
  let chainedEntries = 0;
  let legacyEntries = 0;
  let sequencedEntries = 0;
  let previousHash: string | undefined;
  let lastHash: string | undefined;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    let parsed: AuditLogEntry;
    try {
      parsed = JSON.parse(line) as AuditLogEntry;
    } catch {
      failures.push({
        lineNumber,
        reason: "line is not valid JSON"
      });
      return;
    }

    if (parsed.hash === undefined && parsed.prevHash === undefined) {
      legacyEntries += 1;
      if (previousHash !== undefined) {
        failures.push({
          lineNumber,
          reason:
            "unchained entry appears after the hash chain began (possible tampering or a downgraded writer)"
        });
      }
      return;
    }

    chainedEntries += 1;
    const { hash, ...unhashed } = parsed;

    if (typeof hash !== "string") {
      failures.push({
        lineNumber,
        reason: "chained entry is missing its hash"
      });
      return;
    }

    const expectedHash = computeAuditLogEntryHash(unhashed);
    if (hash !== expectedHash) {
      failures.push({
        lineNumber,
        reason: "entry hash does not match entry contents (entry was modified)"
      });
    }

    const expectedPrevHash = previousHash ?? auditLogChainGenesis;
    if (parsed.prevHash !== expectedPrevHash) {
      failures.push({
        lineNumber,
        reason:
          previousHash === undefined
            ? "first chained entry does not link to the chain genesis marker"
            : "entry does not link to the previous entry (entries were removed, reordered, or inserted)"
      });
    }

    // seq is the entry's absolute line position. A mismatch means lines were
    // added or removed ahead of this one (which also shifts every seq after a
    // middle deletion), independent of the hash-link check above.
    if (parsed.seq !== undefined) {
      sequencedEntries += 1;
      if (parsed.seq !== index) {
        failures.push({
          lineNumber,
          reason: `entry seq ${parsed.seq} does not match its line position ${index} (entries were removed or inserted)`
        });
      }
    }

    previousHash = hash;
    lastHash = hash;
  });

  // Compare the log against the head marker written outside it. This is what
  // makes tail-truncation detectable: a valid prefix of the chain still passes
  // every per-line check, but ends at a lower seq than the head records.
  const headMarker = await readAuditLogHead(path);
  const expectedEntries = headMarker ? headMarker.seq + 1 : null;
  if (headMarker) {
    if (lines.length < headMarker.seq + 1) {
      failures.push({
        lineNumber: lines.length,
        reason: `audit log ends at ${lines.length} ${lines.length === 1 ? "entry" : "entries"} but the head marker records ${headMarker.seq + 1} (entries were truncated from the end)`
      });
    } else if (lines.length > headMarker.seq + 1) {
      failures.push({
        lineNumber: lines.length,
        reason: `audit log has ${lines.length} entries but the head marker records only ${headMarker.seq + 1} (the head marker was not updated; possible tampering or an interrupted write)`
      });
    } else if (lastHash !== undefined && lastHash !== headMarker.hash) {
      failures.push({
        lineNumber: lines.length,
        reason:
          "final entry hash does not match the head marker (the last entry was modified or replaced)"
      });
    }
  } else if (sequencedEntries > 0) {
    // Sequenced entries were written by a version that also writes a head
    // marker, so a missing marker means it was removed. Report it rather than
    // silently accepting an unverifiable-completeness log.
    failures.push({
      lineNumber: lines.length,
      reason:
        "audit head marker is missing but the log contains sequenced entries (removed marker; chain completeness cannot be confirmed)"
    });
  }

  return {
    ok: failures.length === 0,
    path,
    totalLines: lines.length,
    chainedEntries,
    legacyEntries,
    headMarker,
    expectedEntries,
    failures
  };
}

async function readAuditLogFile(path: string): Promise<string> {
  return readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeErrorCode(error, "ENOENT")) {
      return "";
    }

    throw error;
  });
}

async function readChainTipHash(path: string): Promise<string> {
  const lastLine = await readLastAuditLogLine(path);
  if (lastLine === undefined) {
    return auditLogChainGenesis;
  }

  const [parsed] = parseAuditLogLine(lastLine);
  if (parsed && typeof parsed.hash === "string") {
    return parsed.hash;
  }

  // Legacy tail (pre-chain entry or unparseable line): start a fresh chain.
  return auditLogChainGenesis;
}

function auditLogHeadPath(path: string): string {
  return `${path}.head`;
}

export async function readAuditLogHead(
  path: string
): Promise<AuditLogHead | null> {
  const raw = await readFile(auditLogHeadPath(path), "utf8").catch(
    (error: unknown) => {
      if (isNodeErrorCode(error, "ENOENT")) {
        return undefined;
      }
      throw error;
    }
  );
  if (raw === undefined) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AuditLogHead>;
    if (typeof parsed.seq === "number" && typeof parsed.hash === "string") {
      return { seq: parsed.seq, hash: parsed.hash };
    }
  } catch {
    // A corrupt marker is treated as absent; verification then reports the
    // marker as missing rather than trusting an unparseable tip.
  }
  return null;
}

async function writeAuditLogHead(
  path: string,
  head: AuditLogHead
): Promise<void> {
  const headPath = auditLogHeadPath(path);
  const tempPath = `${headPath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(head)}\n`, { mode: 0o600 });
  // Atomic replace so a reader never sees a half-written marker.
  await rename(tempPath, headPath);
}

// The next entry's seq is its absolute line position. The head marker records
// the last seq, so this is O(1) once a marker exists; only a pre-existing log
// with no marker (e.g. written before head markers) pays a one-time line count.
async function nextAuditLogSeq(path: string): Promise<number> {
  const head = await readAuditLogHead(path);
  if (head) {
    return head.seq + 1;
  }
  const raw = await readAuditLogFile(path);
  return raw.split("\n").filter(Boolean).length;
}

async function readLastAuditLogLine(
  path: string
): Promise<string | undefined> {
  const handle = await open(path, "r").catch((error: unknown) => {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  });

  if (handle === undefined) {
    return undefined;
  }

  try {
    const { size } = await handle.stat();
    if (size === 0) {
      return undefined;
    }

    const readLength = Math.min(size, auditLogTailReadBytes);
    const buffer = Buffer.alloc(readLength);
    await handle.read(buffer, 0, readLength, size - readLength);
    const lines = buffer.toString("utf8").split("\n").filter(Boolean);
    return lines.length > 0 ? lines[lines.length - 1] : undefined;
  } finally {
    await handle.close();
  }
}

async function withAuditLogLock<T>(
  path: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockPath = `${path}.lock`;
  const startedAt = Date.now();

  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(
          JSON.stringify({
            pid: process.pid,
            createdAt: new Date().toISOString()
          })
        );
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if (!isNodeErrorCode(error, "EEXIST")) {
        throw error;
      }

      await removeStaleAuditLogLock(lockPath);
      if (Date.now() - startedAt > auditLogLockTimeoutMs) {
        throw new Error(`timed out waiting for audit log lock at ${lockPath}`);
      }
      await sleep(25);
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

async function removeStaleAuditLogLock(lockPath: string): Promise<void> {
  const lockStat = await stat(lockPath).catch((error: unknown) => {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  });

  if (lockStat && Date.now() - lockStat.mtimeMs > auditLogStaleLockMs) {
    await rm(lockPath, { force: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function redactAuditEntry(
  entry: Omit<AuditLogEntry, "version" | "timestamp">
): Omit<AuditLogEntry, "version" | "timestamp"> {
  return {
    ...entry,
    ...(entry.args
      ? { args: entry.args.map((arg) => redactSecretLikeText(arg)) }
      : {}),
    ...(entry.error ? { error: redactSecretLikeText(entry.error) } : {}),
    ...(entry.stdoutSnippet
      ? { stdoutSnippet: redactSecretLikeText(entry.stdoutSnippet) }
      : {}),
    ...(entry.stderrSnippet
      ? { stderrSnippet: redactSecretLikeText(entry.stderrSnippet) }
      : {})
  };
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
