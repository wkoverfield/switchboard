import {
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
import * as z from "zod";
import type { PathResolutionOptions } from "../config/paths.js";

export type MandateRuntimeStatus = "active" | "expired";
export type MandateApprovalRisk = "low" | "medium" | "high" | "critical";
export interface MandateApprovalGate {
  id: string;
  toolPattern: string;
  reason?: string | undefined;
  risk?: MandateApprovalRisk | undefined;
  labels?: string[] | undefined;
}
export interface CreateMandateApprovalGate {
  id?: string | undefined;
  toolPattern: string;
  reason?: string | undefined;
  risk?: string | undefined;
  labels?: string[] | undefined;
}

export type MandateToolPolicyDecision =
  | { allowed: true; approvalRequestId?: string | undefined }
  | { allowed: false; reason: string }
  | {
      allowed: false;
      reason: string;
      approvalRequired: true;
      approvalGate: MandateApprovalGate;
    };
const mandateStoreLockTimeoutMs = 5_000;
const mandateStoreStaleLockMs = 30_000;

export const mandateApprovalGateSchema = z.object({
  id: z.string().min(1),
  toolPattern: z.string().min(1),
  reason: z.string().min(1).optional(),
  risk: z.enum(["low", "medium", "high", "critical"]).optional(),
  labels: z.array(z.string().min(1)).optional()
});

export const mandateSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  task: z.string().min(1),
  repoPath: z.string().min(1),
  worktreePath: z.string().min(1),
  branch: z.string().min(1),
  agentRole: z.string().min(1),
  profiles: z.array(z.string().min(1)),
  lease: z.string().min(1),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  allowedTools: z.array(z.string()),
  deniedTools: z.array(z.string()),
  approvalGates: z
    .array(z.union([mandateApprovalGateSchema, z.string().min(1)]))
    .transform((gates) => normalizeApprovalGates(gates)),
  handoffState: z.literal("open")
});

export const mandateStoreSchema = z.object({
  version: z.literal(1),
  mandates: z.array(mandateSchema)
});

export type Mandate = z.infer<typeof mandateSchema>;
export type MandateStore = z.infer<typeof mandateStoreSchema>;

export type MandateWithStatus = Mandate & {
  runtimeStatus: MandateRuntimeStatus;
};

export interface CreateMandateOptions {
  task: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  agentRole: string;
  profiles: string[];
  lease: string;
  allowedTools?: string[];
  deniedTools?: string[];
  approvalRequiredTools?: Array<string | CreateMandateApprovalGate>;
  path?: string;
  now?: () => Date;
}

export interface MandateToolPolicy {
  allowedTools?: string[];
  deniedTools?: string[];
  approvalGates?: MandateApprovalGate[];
  approvedApprovalRequests?: Array<{
    id?: string | undefined;
    approvalGateId: string;
    toolName: string;
  }>;
}

export interface ListMandatesOptions {
  path?: string;
  repoPath?: string;
  id?: string;
  now?: () => Date;
}

export interface ResolveActiveMandateOptions {
  id: string;
  repoPath: string;
  path?: string;
  now?: () => Date;
}

export function resolveMandateStorePath(
  options: PathResolutionOptions = {}
): string {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const stateRoot = env.XDG_STATE_HOME
    ? resolve(env.XDG_STATE_HOME)
    : join(home, ".local", "state");

  return join(stateRoot, "switchboard", "mandates", "mandates.json");
}

export function normalizeMandateId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function parseMandateLease(value: string): number {
  const match = /^([1-9]\d*)(m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error("lease must use a positive duration like 30m, 2h, or 1d");
  }

  const amountText = match[1];
  const unit = match[2];
  if (!amountText || !unit) {
    throw new Error("lease must use a positive duration like 30m, 2h, or 1d");
  }

  const amount = Number(amountText);
  const unitMs =
    unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;

  return amount * unitMs;
}

export function mandateRuntimeStatus(
  mandate: Pick<Mandate, "expiresAt">,
  now: Date = new Date()
): MandateRuntimeStatus {
  return new Date(mandate.expiresAt).getTime() > now.getTime()
    ? "active"
    : "expired";
}

export function evaluateMandateToolPolicy(
  toolName: string,
  policy: MandateToolPolicy
): MandateToolPolicyDecision {
  const allowedTools = uniqueTrimmed(policy.allowedTools ?? []);
  const deniedTools = uniqueTrimmed(policy.deniedTools ?? []);
  const approvalGates = normalizeApprovalGates(policy.approvalGates ?? []);
  const approvedApprovalRequests = policy.approvedApprovalRequests ?? [];

  if (matchesAnyToolPattern(toolName, deniedTools)) {
    return {
      allowed: false,
      reason: `tool "${toolName}" is denied by mandate policy`
    };
  }

  if (
    allowedTools.length > 0 &&
    !matchesAnyToolPattern(toolName, allowedTools)
  ) {
    return {
      allowed: false,
      reason: `tool "${toolName}" is not allowed by mandate policy`
    };
  }

  const approvalGate = approvalGates.find((gate) =>
    toolPatternToRegExp(gate.toolPattern).test(toolName)
  );
  if (approvalGate) {
    const approvedRequest = approvedApprovalRequests.find(
      (request) =>
        request.approvalGateId === approvalGate.id && request.toolName === toolName
    );
    if (approvedRequest) {
      return (
        approvedRequest.id
          ? { allowed: true, approvalRequestId: approvedRequest.id }
          : { allowed: true }
      );
    }

    return {
      allowed: false,
      approvalRequired: true,
      approvalGate,
      reason: `tool "${toolName}" requires approval by mandate gate "${approvalGate.id}"`
    };
  }

  return { allowed: true };
}

export async function createMandate(
  options: CreateMandateOptions
): Promise<MandateWithStatus> {
  const now = options.now ?? (() => new Date());
  const createdAt = now();
  const id = normalizeMandateId(options.task);
  if (!id) {
    throw new Error("mandate task must produce a non-empty id");
  }

  const agentRole = options.agentRole.trim();
  if (!agentRole) {
    throw new Error("mandate agent role is required");
  }

  const branch = options.branch.trim();
  if (!branch) {
    throw new Error("mandate branch is required");
  }

  const profiles = uniqueTrimmed(options.profiles);
  if (profiles.length === 0) {
    throw new Error("mandate requires at least one profile");
  }
  const allowedTools = uniqueTrimmed(options.allowedTools ?? []);
  const deniedTools = uniqueTrimmed(options.deniedTools ?? []);
  const approvalGates = normalizeApprovalGates(
    options.approvalRequiredTools ?? []
  );

  const leaseMs = parseMandateLease(options.lease);
  const repoPath = resolve(options.repoPath);
  const worktreePath = resolve(options.worktreePath);
  const path = options.path ?? resolveMandateStorePath();

  return withMandateStoreLock(path, async () => {
    const store = await readMandateStore({ path });
    const activeDuplicate = store.mandates.find(
      (mandate) =>
        mandate.id === id &&
        mandate.repoPath === repoPath &&
        mandateRuntimeStatus(mandate, createdAt) === "active"
    );
    if (activeDuplicate) {
      throw new Error(
        `active mandate "${id}" already exists for ${repoPath}; choose a different task name or wait for it to expire`
      );
    }

    const mandate: Mandate = {
      version: 1,
      id,
      task: options.task.trim(),
      repoPath,
      worktreePath,
      branch,
      agentRole,
      profiles,
      lease: options.lease.trim(),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + leaseMs).toISOString(),
      allowedTools,
      deniedTools,
      approvalGates,
      handoffState: "open"
    };

    store.mandates.push(mandate);
    await writeMandateStore(store, { path });

    return withRuntimeStatus(mandate, createdAt);
  });
}

export async function listMandates(
  options: ListMandatesOptions = {}
): Promise<MandateWithStatus[]> {
  const now = options.now?.() ?? new Date();
  const store = await readMandateStore(options.path ? { path: options.path } : {});
  const repoPath = options.repoPath ? resolve(options.repoPath) : undefined;
  const id = options.id ? normalizeMandateId(options.id) : undefined;

  return store.mandates
    .filter((mandate) => (repoPath ? mandate.repoPath === repoPath : true))
    .filter((mandate) => (id ? mandate.id === id : true))
    .map((mandate) => withRuntimeStatus(mandate, now));
}

export async function resolveActiveMandate(
  options: ResolveActiveMandateOptions
): Promise<MandateWithStatus> {
  const id = normalizeMandateId(options.id);
  if (!id) {
    throw new Error("mandate id is required");
  }

  const mandates = await listMandates({
    ...(options.path ? { path: options.path } : {}),
    repoPath: options.repoPath,
    id,
    ...(options.now ? { now: options.now } : {})
  });
  if (mandates.length === 0) {
    throw new Error(`mandate "${id}" was not found for ${resolve(options.repoPath)}`);
  }
  const mandate = mandates.find((item) => item.runtimeStatus === "active");
  if (!mandate) {
    throw new Error(`mandate "${id}" is expired`);
  }

  return mandate;
}

export async function readMandateStore(options: {
  path?: string;
} = {}): Promise<MandateStore> {
  const path = options.path ?? resolveMandateStorePath();
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

  if (!raw.trim()) {
    return { version: 1, mandates: [] };
  }

  const parsed = JSON.parse(raw) as unknown;
  const result = mandateStoreSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `invalid Switchboard mandate store at ${path}: ${z.prettifyError(result.error)}`
    );
  }

  return result.data;
}

async function writeMandateStore(
  store: MandateStore,
  options: { path?: string } = {}
): Promise<void> {
  const path = options.path ?? resolveMandateStorePath();
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600
  });
  await chmod(tempPath, 0o600);
  await rename(tempPath, path);
  await chmod(path, 0o600);
}

async function withMandateStoreLock<T>(
  path: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockPath = `${path}.lock`;
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })
        );
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if (!isNodeErrorCode(error, "EEXIST")) {
        throw error;
      }

      await removeStaleLock(lockPath);
      if (Date.now() - startedAt > mandateStoreLockTimeoutMs) {
        throw new Error(`timed out waiting for mandate store lock at ${lockPath}`);
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

async function removeStaleLock(lockPath: string): Promise<void> {
  const lockStat = await stat(lockPath).catch((error: unknown) => {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  });

  if (lockStat && Date.now() - lockStat.mtimeMs > mandateStoreStaleLockMs) {
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
    error.code === code
  );
}

function withRuntimeStatus(mandate: Mandate, now: Date): MandateWithStatus {
  return {
    ...mandate,
    runtimeStatus: mandateRuntimeStatus(mandate, now)
  };
}

function uniqueTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function normalizeApprovalGates(
  gates: Array<string | CreateMandateApprovalGate>
): MandateApprovalGate[] {
  const seen = new Set<string>();
  const result: MandateApprovalGate[] = [];

  for (const gate of gates) {
    const toolPattern =
      typeof gate === "string" ? gate.trim() : gate.toolPattern.trim();
    if (!toolPattern || seen.has(toolPattern)) {
      continue;
    }

    seen.add(toolPattern);
    const id =
      typeof gate === "string" || !gate.id?.trim()
        ? `gate-${result.length + 1}`
        : gate.id.trim();
    const reason =
      typeof gate === "string" ? undefined : gate.reason?.trim() || undefined;
    if (reason && hasControlCharacters(reason)) {
      throw new Error("approval gate reason must not contain control characters");
    }
    const risk = typeof gate === "string" ? undefined : normalizeApprovalRisk(gate.risk);
    const labels =
      typeof gate === "string" ? [] : normalizeApprovalLabels(gate.labels ?? []);
    result.push({
      id,
      toolPattern,
      ...(reason ? { reason } : {}),
      ...(risk ? { risk } : {}),
      ...(labels.length > 0 ? { labels } : {})
    });
  }

  return result;
}

function normalizeApprovalRisk(
  value: string | undefined
): MandateApprovalRisk | undefined {
  const risk = value?.trim().toLowerCase();
  if (!risk) {
    return undefined;
  }
  if (
    risk !== "low" &&
    risk !== "medium" &&
    risk !== "high" &&
    risk !== "critical"
  ) {
    throw new Error(
      "approval gate risk must be one of: low, medium, high, critical"
    );
  }

  return risk;
}

function normalizeApprovalLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawLabel of labels) {
    const label = rawLabel.trim().toLowerCase();
    if (!label || seen.has(label)) {
      continue;
    }
    if (hasControlCharacters(label)) {
      throw new Error("approval gate labels must not contain control characters");
    }
    if (!/^[a-z0-9][a-z0-9_.:-]*$/.test(label)) {
      throw new Error(
        "approval gate labels must use lowercase letters, digits, dots, colons, underscores, or hyphens"
      );
    }
    seen.add(label);
    result.push(label);
  }

  return result;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((char) => {
    const codePoint = char.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
}

function matchesAnyToolPattern(toolName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => toolPatternToRegExp(pattern).test(toolName));
}

function toolPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}
