import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as z from "zod";
import type { PathResolutionOptions } from "../config/paths.js";

export type ApprovalRequestStatus = "pending" | "approved" | "denied" | "stale";
export type ApprovalRequestRuntimeStatus =
  | ApprovalRequestStatus
  | "expired";

const approvalStoreLockTimeoutMs = 5_000;
const approvalStoreStaleLockMs = 30_000;

export const approvalRequestSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  mandateId: z.string().min(1),
  repoPath: z.string().min(1),
  branch: z.string().min(1),
  toolName: z.string().min(1),
  approvalGateId: z.string().min(1),
  approvalGatePattern: z.string().min(1),
  approvalGateReason: z.string().min(1).optional(),
  approvalGateRisk: z.enum(["low", "medium", "high", "critical"]).optional(),
  approvalGateLabels: z.array(z.string().min(1)).optional(),
  status: z.enum(["pending", "approved", "denied", "stale"]),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  decidedAt: z.string().min(1).optional(),
  decisionReason: z.string().min(1).optional()
});

export const approvalRequestStoreSchema = z.object({
  version: z.literal(1),
  requests: z.array(approvalRequestSchema)
});

export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ApprovalRequestStore = z.infer<typeof approvalRequestStoreSchema>;
export type ApprovalRequestWithStatus = ApprovalRequest & {
  runtimeStatus: ApprovalRequestRuntimeStatus;
};

export interface CreateApprovalRequestOptions {
  mandateId: string;
  repoPath: string;
  branch: string;
  toolName: string;
  approvalGateId: string;
  approvalGatePattern: string;
  approvalGateReason?: string;
  approvalGateRisk?: "low" | "medium" | "high" | "critical";
  approvalGateLabels?: string[];
  expiresAt: string;
  path?: string;
  now?: () => Date;
}

export interface ListApprovalRequestsOptions {
  path?: string;
  repoPath?: string;
  mandateId?: string;
  status?: ApprovalRequestRuntimeStatus;
  now?: () => Date;
}

export interface DecideApprovalRequestOptions {
  id: string;
  status: "approved" | "denied";
  reason?: string;
  path?: string;
  now?: () => Date;
}

export interface MarkApprovalRequestStaleOptions {
  id: string;
  reason?: string;
  path?: string;
  now?: () => Date;
}

export interface MarkPendingApprovalRequestsStaleOptions {
  repoPath?: string;
  mandateId?: string;
  reason?: string;
  path?: string;
  now?: () => Date;
}

export interface FindApprovedApprovalRequestOptions {
  mandateId: string;
  repoPath: string;
  toolName: string;
  approvalGateId: string;
  path?: string;
  now?: () => Date;
}

export function resolveApprovalRequestStorePath(
  options: PathResolutionOptions = {}
): string {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const stateRoot = env.XDG_STATE_HOME
    ? resolve(env.XDG_STATE_HOME)
    : join(home, ".local", "state");

  return join(stateRoot, "switchboard", "approvals", "approvals.json");
}

export function approvalRequestRuntimeStatus(
  request: Pick<ApprovalRequest, "status" | "expiresAt">,
  now: Date = new Date()
): ApprovalRequestRuntimeStatus {
  if (request.status === "stale") {
    return "stale";
  }

  const expiresAtMs = Date.parse(request.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return "expired";
  }

  if (expiresAtMs <= now.getTime()) {
    return "expired";
  }

  return request.status;
}

export async function createApprovalRequest(
  options: CreateApprovalRequestOptions
): Promise<ApprovalRequestWithStatus> {
  const now = options.now ?? (() => new Date());
  const createdAt = now();
  const repoPath = resolve(options.repoPath);
  const path = options.path ?? resolveApprovalRequestStorePath();
  const approvalGateRisk = normalizeApprovalGateRisk(options.approvalGateRisk);
  const approvalGateLabels = normalizeApprovalGateLabels(
    options.approvalGateLabels ?? []
  );

  return withApprovalStoreLock(path, async () => {
    const store = await readApprovalRequestStore({ path });
    const existing = store.requests.find(
      (request) =>
        request.mandateId === options.mandateId &&
        request.repoPath === repoPath &&
        request.toolName === options.toolName &&
        request.approvalGateId === options.approvalGateId &&
        approvalRequestRuntimeStatus(request, createdAt) === "pending"
    );
    if (existing) {
      return withRuntimeStatus(existing, createdAt);
    }

    const request: ApprovalRequest = {
      version: 1,
      id: nextApprovalRequestId(store),
      mandateId: options.mandateId,
      repoPath,
      branch: options.branch.trim(),
      toolName: options.toolName.trim(),
      approvalGateId: options.approvalGateId.trim(),
      approvalGatePattern: options.approvalGatePattern.trim(),
      ...(options.approvalGateReason?.trim()
        ? { approvalGateReason: options.approvalGateReason.trim() }
        : {}),
      ...(approvalGateRisk
        ? { approvalGateRisk }
        : {}),
      ...(approvalGateLabels.length > 0
        ? { approvalGateLabels }
        : {}),
      status: "pending",
      createdAt: createdAt.toISOString(),
      expiresAt: options.expiresAt
    };

    store.requests.push(request);
    await writeApprovalRequestStore(store, { path });
    return withRuntimeStatus(request, createdAt);
  });
}

export async function listApprovalRequests(
  options: ListApprovalRequestsOptions = {}
): Promise<ApprovalRequestWithStatus[]> {
  const now = options.now?.() ?? new Date();
  const store = await readApprovalRequestStore(
    options.path ? { path: options.path } : {}
  );
  const repoPath = options.repoPath ? resolve(options.repoPath) : undefined;

  return store.requests
    .filter((request) => (repoPath ? request.repoPath === repoPath : true))
    .filter((request) =>
      options.mandateId ? request.mandateId === options.mandateId : true
    )
    .map((request) => withRuntimeStatus(request, now))
    .filter((request) =>
      options.status ? request.runtimeStatus === options.status : true
    );
}

export async function findApprovedApprovalRequest(
  options: FindApprovedApprovalRequestOptions
): Promise<ApprovalRequestWithStatus | undefined> {
  const now = options.now?.() ?? new Date();
  const repoPath = resolve(options.repoPath);
  const store = await readApprovalRequestStore(
    options.path ? { path: options.path } : {}
  );

  const request = store.requests.find(
    (item) =>
      item.mandateId === options.mandateId &&
      item.repoPath === repoPath &&
      item.toolName === options.toolName &&
      item.approvalGateId === options.approvalGateId &&
      item.status === "approved" &&
      approvalRequestRuntimeStatus(item, now) === "approved"
  );

  return request ? withRuntimeStatus(request, now) : undefined;
}

export async function decideApprovalRequest(
  options: DecideApprovalRequestOptions
): Promise<ApprovalRequestWithStatus> {
  const now = options.now ?? (() => new Date());
  const decidedAt = now();
  const path = options.path ?? resolveApprovalRequestStorePath();

  return withApprovalStoreLock(path, async () => {
    const store = await readApprovalRequestStore({ path });
    const index = store.requests.findIndex((request) => request.id === options.id);
    if (index < 0) {
      throw new Error(`approval request "${options.id}" was not found`);
    }

    const current = store.requests[index];
    if (!current) {
      throw new Error(`approval request "${options.id}" was not found`);
    }
    if (approvalRequestRuntimeStatus(current, decidedAt) === "expired") {
      throw new Error(`approval request "${options.id}" is expired`);
    }
    if (approvalRequestRuntimeStatus(current, decidedAt) === "stale") {
      throw new Error(`approval request "${options.id}" is stale`);
    }
    if (current.status !== "pending") {
      throw new Error(
        `approval request "${options.id}" is already ${current.status}`
      );
    }

    const reason = options.reason?.trim();
    const updated: ApprovalRequest = {
      ...current,
      status: options.status,
      decidedAt: decidedAt.toISOString(),
      ...(reason ? { decisionReason: reason } : {})
    };
    store.requests[index] = updated;
    await writeApprovalRequestStore(store, { path });
    return withRuntimeStatus(updated, decidedAt);
  });
}

export async function markApprovalRequestStale(
  options: MarkApprovalRequestStaleOptions
): Promise<ApprovalRequestWithStatus> {
  const now = options.now ?? (() => new Date());
  const decidedAt = now();
  const path = options.path ?? resolveApprovalRequestStorePath();

  return withApprovalStoreLock(path, async () => {
    const store = await readApprovalRequestStore({ path });
    const index = store.requests.findIndex((request) => request.id === options.id);
    if (index < 0) {
      throw new Error(`approval request "${options.id}" was not found`);
    }

    const current = store.requests[index];
    if (!current) {
      throw new Error(`approval request "${options.id}" was not found`);
    }
    if (approvalRequestRuntimeStatus(current, decidedAt) === "expired") {
      return withRuntimeStatus(current, decidedAt);
    }
    if (current.status === "denied" || current.status === "stale") {
      return withRuntimeStatus(current, decidedAt);
    }

    const reason = options.reason?.trim();
    const updated: ApprovalRequest = {
      ...current,
      status: "stale",
      decidedAt: decidedAt.toISOString(),
      ...(reason ? { decisionReason: reason } : {})
    };
    store.requests[index] = updated;
    await writeApprovalRequestStore(store, { path });
    return withRuntimeStatus(updated, decidedAt);
  });
}

export async function markPendingApprovalRequestsStale(
  options: MarkPendingApprovalRequestsStaleOptions = {}
): Promise<ApprovalRequestWithStatus[]> {
  const now = options.now ?? (() => new Date());
  const decidedAt = now();
  const path = options.path ?? resolveApprovalRequestStorePath();
  const repoPath = options.repoPath ? resolve(options.repoPath) : undefined;

  return withApprovalStoreLock(path, async () => {
    const store = await readApprovalRequestStore({ path });
    const staleRequests: ApprovalRequestWithStatus[] = [];
    let changed = false;
    const reason = options.reason?.trim();

    store.requests = store.requests.map((request) => {
      const matchesRepo = repoPath ? request.repoPath === repoPath : true;
      const matchesMandate = options.mandateId
        ? request.mandateId === options.mandateId
        : true;
      if (
        !matchesRepo ||
        !matchesMandate ||
        approvalRequestRuntimeStatus(request, decidedAt) !== "pending"
      ) {
        return request;
      }

      changed = true;
      const updated: ApprovalRequest = {
        ...request,
        status: "stale",
        decidedAt: decidedAt.toISOString(),
        ...(reason ? { decisionReason: reason } : {})
      };
      staleRequests.push(withRuntimeStatus(updated, decidedAt));
      return updated;
    });

    if (changed) {
      await writeApprovalRequestStore(store, { path });
    }

    return staleRequests;
  });
}

export async function readApprovalRequestStore(options: {
  path?: string;
} = {}): Promise<ApprovalRequestStore> {
  const path = options.path ?? resolveApprovalRequestStorePath();
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeErrorCode(error, "ENOENT")) {
      return "";
    }
    throw error;
  });

  if (!raw.trim()) {
    return { version: 1, requests: [] };
  }

  const parsed = JSON.parse(raw) as unknown;
  const result = approvalRequestStoreSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `invalid Switchboard approval request store at ${path}: ${z.prettifyError(result.error)}`
    );
  }

  return result.data;
}

async function writeApprovalRequestStore(
  store: ApprovalRequestStore,
  options: { path?: string } = {}
): Promise<void> {
  const path = options.path ?? resolveApprovalRequestStorePath();
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600
  });
  await chmod(tempPath, 0o600);
  await rename(tempPath, path);
  await chmod(path, 0o600);
}

async function withApprovalStoreLock<T>(
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
      if (Date.now() - startedAt > approvalStoreLockTimeoutMs) {
        throw new Error(`timed out waiting for approval store lock at ${lockPath}`);
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

  if (lockStat && Date.now() - lockStat.mtimeMs > approvalStoreStaleLockMs) {
    await rm(lockPath, { force: true });
  }
}

function nextApprovalRequestId(store: ApprovalRequestStore): string {
  return `approval-${store.requests.length + 1}`;
}

function normalizeApprovalGateRisk(
  value: string | undefined
): "low" | "medium" | "high" | "critical" | undefined {
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

function normalizeApprovalGateLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawLabel of labels) {
    const label = rawLabel.trim().toLowerCase();
    if (!label || seen.has(label)) {
      continue;
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

function withRuntimeStatus(
  request: ApprovalRequest,
  now: Date
): ApprovalRequestWithStatus {
  return {
    ...request,
    runtimeStatus: approvalRequestRuntimeStatus(request, now)
  };
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
