import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
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
export type MandateHandoffState = "open" | "completed" | "blocked" | "cancelled";
export type MandateApprovalRisk = "low" | "medium" | "high" | "critical";
export type MandateAuthoritySourceType =
  | "preset"
  | "authority-map"
  | "parent"
  | "manual";
export interface MandateAuthoritySource {
  type: MandateAuthoritySourceType;
  ref?: string | undefined;
}
export type MandateLeaseEventType = "created" | "renewed";
export interface MandateLeaseEvent {
  type: MandateLeaseEventType;
  at: string;
  lease: string;
  expiresAt: string;
  actor?: string | undefined;
}
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

interface NormalizedCreateMandateOptions {
  id: string;
  mandateUid: string;
  task: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  agentRole: string;
  profiles: string[];
  lease: string;
  leaseMs: number;
  allowedTools: string[];
  deniedTools: string[];
  approvalGates: MandateApprovalGate[];
  createdBy?: string | undefined;
  authoritySource?: MandateAuthoritySource | undefined;
  parentMandateId?: string | undefined;
  parentMandateUid?: string | undefined;
  delegatedBy?: string | undefined;
  delegationPath?: string[] | undefined;
  delegationUids?: string[] | undefined;
  maxLeaseExpiresAt?: string | undefined;
}

export const mandateApprovalGateSchema = z.object({
  id: z.string().min(1),
  toolPattern: z.string().min(1),
  reason: z.string().min(1).optional(),
  risk: z.enum(["low", "medium", "high", "critical"]).optional(),
  labels: z.array(z.string().min(1)).optional()
});

export const mandateHandoffStateSchema = z.enum([
  "open",
  "completed",
  "blocked",
  "cancelled"
]);

export const mandateAuthoritySourceSchema = z.object({
  type: z.enum(["preset", "authority-map", "parent", "manual"]),
  ref: z.string().min(1).optional()
});

export const mandateLeaseEventSchema = z.object({
  type: z.enum(["created", "renewed"]),
  at: z.string().min(1),
  lease: z.string().min(1),
  expiresAt: z.string().min(1),
  actor: z.string().min(1).optional()
});

export const mandateSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  mandateUid: z.string().min(1).optional(),
  task: z.string().min(1),
  parentMandateId: z.string().min(1).optional(),
  parentMandateUid: z.string().min(1).optional(),
  delegatedBy: z.string().min(1).optional(),
  delegationPath: z.array(z.string().min(1)).optional(),
  delegationUids: z.array(z.string().min(1)).optional(),
  maxLeaseExpiresAt: z.string().min(1).optional(),
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
  createdBy: z.string().min(1).optional(),
  authoritySource: mandateAuthoritySourceSchema.optional(),
  policyHash: z.string().min(1).optional(),
  leaseEvents: z.array(mandateLeaseEventSchema).optional(),
  handoffState: mandateHandoffStateSchema,
  handoffSummary: z.string().min(1).optional(),
  handoffNextSteps: z.array(z.string().min(1)).optional(),
  handoffArtifacts: z.array(z.string().min(1)).optional(),
  handoffBy: z.string().min(1).optional(),
  handoffAt: z.string().min(1).optional()
});

export const mandateStoreSchema = z.object({
  version: z.literal(1),
  mandates: z.array(mandateSchema)
});

export type Mandate = z.infer<typeof mandateSchema>;
export type MandateStore = z.infer<typeof mandateStoreSchema>;

export type MandateWithStatus = Mandate & {
  runtimeStatus: MandateRuntimeStatus | "closed";
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
  createdBy?: string | undefined;
  authoritySource?: MandateAuthoritySource | undefined;
  path?: string;
  now?: () => Date;
}

export interface RenewMandateOptions {
  id: string;
  repoPath: string;
  lease: string;
  actor?: string | undefined;
  path?: string;
  now?: () => Date;
}

export interface CreateChildMandateOptions {
  parentId: string;
  task: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  agentRole: string;
  profiles: string[];
  lease: string;
  delegatedBy?: string | undefined;
  allowedTools?: string[];
  deniedTools?: string[];
  approvalRequiredTools?: Array<string | CreateMandateApprovalGate>;
  createdBy?: string | undefined;
  authoritySource?: MandateAuthoritySource | undefined;
  path?: string;
  now?: () => Date;
}

export interface UpdateMandateHandoffOptions {
  id: string;
  repoPath: string;
  state: Exclude<MandateHandoffState, "open">;
  summary?: string | undefined;
  nextSteps?: string[];
  artifacts?: string[];
  handoffBy?: string | undefined;
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
  mandate: Pick<Mandate, "expiresAt"> & Partial<Pick<Mandate, "handoffState">>,
  now: Date = new Date()
): MandateWithStatus["runtimeStatus"] {
  if (mandate.handoffState && mandate.handoffState !== "open") {
    return "closed";
  }

  return new Date(mandate.expiresAt).getTime() > now.getTime()
    ? "active"
    : "expired";
}

export interface MandatePolicyHashInput {
  profiles: string[];
  allowedTools: string[];
  deniedTools: string[];
  approvalGates: MandateApprovalGate[];
}

export function computeMandatePolicyHash(
  input: MandatePolicyHashInput
): string {
  const canonical = JSON.stringify({
    profiles: input.profiles,
    allowedTools: input.allowedTools,
    deniedTools: input.deniedTools,
    approvalGates: input.approvalGates.map((gate) => ({
      id: gate.id,
      toolPattern: gate.toolPattern,
      reason: gate.reason ?? null,
      risk: gate.risk ?? null,
      labels: gate.labels ?? []
    }))
  });

  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
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

  const approvalGate = lastMatchingApprovalGate(approvalGates, toolName);
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
  const normalized = normalizeCreateMandateOptions(options, createdAt);
  const path = options.path ?? resolveMandateStorePath();

  return withMandateStoreLock(path, async () => {
    const store = await readMandateStore({ path });
    assertNoActiveDuplicate(store, normalized, createdAt);
    const mandate = buildMandate(normalized, createdAt);

    store.mandates.push(mandate);
    await writeMandateStore(store, { path });

    return withRuntimeStatus(mandate, createdAt);
  });
}

export async function createChildMandate(
  options: CreateChildMandateOptions
): Promise<MandateWithStatus> {
  const now = options.now ?? (() => new Date());
  const createdAt = now();
  const child = normalizeCreateMandateOptions(options, createdAt);
  const parentId = normalizeMandateId(options.parentId);
  if (!parentId) {
    throw new Error("parent mandate id is required");
  }
  const path = options.path ?? resolveMandateStorePath();

  return withMandateStoreLock(path, async () => {
    const store = await readMandateStore({ path });
    const parent = store.mandates.find(
      (mandate) =>
        mandate.id === parentId &&
        mandate.repoPath === child.repoPath &&
        mandateRuntimeStatus(mandate, createdAt) === "active"
    );
    if (!parent) {
      throw new Error(
        `active parent mandate "${parentId}" was not found for ${child.repoPath}`
      );
    }

    const normalizedParent = withRuntimeStatus(parent, createdAt);
    validateChildMandateScope(child, normalizedParent, createdAt);
    assertNoActiveDuplicate(store, child, createdAt);

    const inheritedDeniedTools = uniqueTrimmed([
      ...normalizedParent.deniedTools,
      ...(options.deniedTools ?? [])
    ]);
    const childApprovalGates = normalizeApprovalGates(
      options.approvalRequiredTools ?? [],
      normalizedParent.approvalGates.length
    );
    const inheritedApprovalPatterns = new Set(
      normalizedParent.approvalGates.map((gate) => gate.toolPattern)
    );
    const duplicateApprovalGate = childApprovalGates.find((gate) =>
      inheritedApprovalPatterns.has(gate.toolPattern)
    );
    if (duplicateApprovalGate) {
      throw new Error(
        `child approval gate "${duplicateApprovalGate.toolPattern}" is already inherited from parent mandate "${normalizedParent.id}"; omit the duplicate gate or choose a narrower tool pattern`
      );
    }
    const approvalGates = [
      ...normalizedParent.approvalGates,
      ...childApprovalGates
    ];
    const parentDelegationPath =
      normalizedParent.delegationPath ?? [normalizedParent.id];
    const parentUid = mandateUidFor(normalizedParent);
    const parentDelegationUids =
      normalizedParent.delegationUids ?? [parentUid];
    const mandate = buildMandate(
      {
        ...child,
        allowedTools:
          child.allowedTools.length > 0
            ? child.allowedTools
            : normalizedParent.allowedTools,
        deniedTools: inheritedDeniedTools,
        approvalGates,
        authoritySource:
          child.authoritySource ?? {
            type: "parent",
            ref: normalizedParent.id
          },
        parentMandateId: normalizedParent.id,
        parentMandateUid: parentUid,
        delegatedBy: options.delegatedBy?.trim() || normalizedParent.id,
        delegationPath: [...parentDelegationPath, child.id],
        delegationUids: [...parentDelegationUids, child.mandateUid],
        maxLeaseExpiresAt:
          normalizedParent.maxLeaseExpiresAt ?? normalizedParent.expiresAt
      },
      createdAt
    );

    store.mandates.push(mandate);
    await writeMandateStore(store, { path });

    return withRuntimeStatus(mandate, createdAt);
  });
}

export async function updateMandateHandoff(
  options: UpdateMandateHandoffOptions
): Promise<MandateWithStatus> {
  const id = normalizeMandateId(options.id);
  if (!id) {
    throw new Error("mandate id is required");
  }
  const repoPath = resolve(options.repoPath);
  const now = options.now ?? (() => new Date());
  const handedOffAt = now();
  if (!Number.isFinite(handedOffAt.getTime())) {
    throw new Error("mandate handoff time is invalid");
  }
  const path = options.path ?? resolveMandateStorePath();

  return withMandateStoreLock(path, async () => {
    const store = await readMandateStore({ path });
    const mandateIndex = findLatestMandateIndex(store.mandates, id, repoPath);
    if (mandateIndex === -1) {
      throw new Error(`mandate "${id}" was not found for ${repoPath}`);
    }

    const mandate = store.mandates[mandateIndex];
    if (!mandate) {
      throw new Error(`mandate "${id}" was not found for ${repoPath}`);
    }
    const openDescendants = descendantMandates(store.mandates, mandate).filter(
      (descendant) => descendant.handoffState === "open"
    );
    if (openDescendants.length > 0) {
      throw new Error(
        `cannot hand off mandate "${id}" while child mandates remain open: ${openDescendants
          .map((descendant) => descendant.id)
          .join(", ")}`
      );
    }

    const handoffSummary = normalizeOptionalText(
      options.summary,
      "handoff summary"
    );
    const handoffNextSteps = normalizeOptionalList(
      options.nextSteps ?? [],
      "handoff next step"
    );
    const handoffArtifacts = normalizeOptionalList(
      options.artifacts ?? [],
      "handoff artifact"
    );
    const handoffBy = normalizeOptionalText(options.handoffBy, "handoff by");
    const updatedMandate = {
      ...mandate,
      handoffState: options.state,
      ...(handoffSummary ? { handoffSummary } : {}),
      ...(handoffNextSteps.length > 0 ? { handoffNextSteps } : {}),
      ...(handoffArtifacts.length > 0 ? { handoffArtifacts } : {}),
      ...(handoffBy ? { handoffBy } : {}),
      handoffAt: handedOffAt.toISOString()
    };

    store.mandates[mandateIndex] = updatedMandate;
    await writeMandateStore(store, { path });

    return withRuntimeStatus(updatedMandate, handedOffAt);
  });
}

export async function renewMandate(
  options: RenewMandateOptions
): Promise<MandateWithStatus> {
  const id = normalizeMandateId(options.id);
  if (!id) {
    throw new Error("mandate id is required");
  }
  const repoPath = resolve(options.repoPath);
  const leaseMs = parseMandateLease(options.lease);
  const now = options.now ?? (() => new Date());
  const renewedAt = now();
  if (!Number.isFinite(renewedAt.getTime())) {
    throw new Error("mandate renewal time is invalid");
  }
  const path = options.path ?? resolveMandateStorePath();

  return withMandateStoreLock(path, async () => {
    const store = await readMandateStore({ path });
    const mandateIndex = findLatestMandateIndex(store.mandates, id, repoPath);
    if (mandateIndex === -1) {
      throw new Error(`mandate "${id}" was not found for ${repoPath}`);
    }

    const mandate = store.mandates[mandateIndex];
    if (!mandate) {
      throw new Error(`mandate "${id}" was not found for ${repoPath}`);
    }
    if (mandate.handoffState !== "open") {
      throw new Error(
        `mandate "${id}" is closed with handoff state "${mandate.handoffState}"`
      );
    }

    const expiresAt = new Date(renewedAt.getTime() + leaseMs).toISOString();
    if (mandate.maxLeaseExpiresAt && Date.parse(expiresAt) > Date.parse(mandate.maxLeaseExpiresAt)) {
      throw new Error("mandate renewal cannot outlive parent mandate lease");
    }

    const actor = normalizeOptionalText(options.actor, "mandate renewal actor");
    const renewedMandate = {
      ...mandate,
      lease: options.lease.trim(),
      expiresAt,
      leaseEvents: [
        ...(mandate.leaseEvents ?? []),
        {
          type: "renewed" as const,
          at: renewedAt.toISOString(),
          lease: options.lease.trim(),
          expiresAt,
          ...(actor ? { actor } : {})
        }
      ]
    };
    store.mandates[mandateIndex] = renewedMandate;
    await writeMandateStore(store, { path });

    return withRuntimeStatus(renewedMandate, renewedAt);
  });
}

export async function listMandates(
  options: ListMandatesOptions = {}
): Promise<MandateWithStatus[]> {
  const now = options.now?.() ?? new Date();
  const store = await readMandateStore(options.path ? { path: options.path } : {});
  const repoPath = options.repoPath ? canonicalPath(options.repoPath) : undefined;
  const id = options.id ? normalizeMandateId(options.id) : undefined;

  return store.mandates
    .filter((mandate) =>
      repoPath ? canonicalPath(mandate.repoPath) === repoPath : true
    )
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
    const closedMandate = mandates.find((item) => item.runtimeStatus === "closed");
    if (closedMandate) {
      throw new Error(
        `mandate "${id}" is closed with handoff state "${closedMandate.handoffState}"`
      );
    }
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

function createMandateUid(id: string, createdAt: Date): string {
  return `${id}:${createdAt.toISOString()}`;
}

function mandateUidFor(
  mandate: Pick<Mandate, "id" | "createdAt" | "mandateUid">
): string {
  return (
    mandate.mandateUid ?? createMandateUid(mandate.id, new Date(mandate.createdAt))
  );
}

function findLatestMandateIndex(
  mandates: Mandate[],
  id: string,
  repoPath: string
): number {
  for (let index = mandates.length - 1; index >= 0; index -= 1) {
    const mandate = mandates[index];
    if (
      mandate?.id === id &&
      canonicalPath(mandate.repoPath) === canonicalPath(repoPath)
    ) {
      return index;
    }
  }

  return -1;
}

function descendantMandates(mandates: Mandate[], parent: Mandate): Mandate[] {
  const descendants: Mandate[] = [];
  const parentIds = new Set([parent.id]);
  const parentUid = parent.mandateUid;
  const parentUids = new Set(parentUid ? [parentUid] : []);

  for (const mandate of mandates) {
    if (
      mandate.repoPath !== parent.repoPath ||
      (parentUid ? mandate.mandateUid === parentUid : mandate.id === parent.id)
    ) {
      continue;
    }

    if (parentUid) {
      const delegationUids = mandate.delegationUids ?? [];
      if (
        mandate.parentMandateUid === parentUid ||
        delegationUids.some((uid) => parentUids.has(uid))
      ) {
        descendants.push(mandate);
        if (mandate.mandateUid) {
          parentUids.add(mandate.mandateUid);
        }
      }
      continue;
    }

    const delegationPath = mandate.delegationPath ?? [];
    if (
      mandate.parentMandateId === parent.id ||
      delegationPath.some((id) => parentIds.has(id))
    ) {
      descendants.push(mandate);
      parentIds.add(mandate.id);
    }
  }

  return descendants;
}

function normalizeCreateMandateOptions(
  options: CreateMandateOptions | CreateChildMandateOptions,
  createdAt: Date
): NormalizedCreateMandateOptions {
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

  const leaseMs = parseMandateLease(options.lease);
  if (!Number.isFinite(createdAt.getTime())) {
    throw new Error("mandate creation time is invalid");
  }

  return {
    id,
    mandateUid: createMandateUid(id, createdAt),
    task: options.task.trim(),
    repoPath: resolve(options.repoPath),
    worktreePath: resolve(options.worktreePath),
    branch,
    agentRole,
    profiles,
    lease: options.lease.trim(),
    leaseMs,
    allowedTools: uniqueTrimmed(options.allowedTools ?? []),
    deniedTools: uniqueTrimmed(options.deniedTools ?? []),
    approvalGates: normalizeApprovalGates(options.approvalRequiredTools ?? []),
    createdBy: normalizeOptionalText(options.createdBy, "mandate created by"),
    authoritySource: normalizeAuthoritySource(options.authoritySource)
  };
}

function normalizeAuthoritySource(
  source: MandateAuthoritySource | undefined
): MandateAuthoritySource | undefined {
  if (!source) {
    return undefined;
  }

  const ref = normalizeOptionalText(source.ref, "authority source ref");
  return { type: source.type, ...(ref ? { ref } : {}) };
}

function assertNoActiveDuplicate(
  store: MandateStore,
  mandate: Pick<NormalizedCreateMandateOptions, "id" | "repoPath">,
  now: Date
): void {
  const activeDuplicate = store.mandates.find(
    (existing) =>
      existing.id === mandate.id &&
      canonicalPath(existing.repoPath) === canonicalPath(mandate.repoPath) &&
      mandateRuntimeStatus(existing, now) === "active"
  );
  if (activeDuplicate) {
    throw new Error(
      `active mandate "${mandate.id}" already exists for ${mandate.repoPath}; choose a different task name or wait for it to expire`
    );
  }
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function buildMandate(
  options: NormalizedCreateMandateOptions,
  createdAt: Date
): Mandate {
  const expiresAt = new Date(
    createdAt.getTime() + options.leaseMs
  ).toISOString();

  return {
    version: 1,
    id: options.id,
    mandateUid: options.mandateUid,
    task: options.task,
    ...(options.parentMandateId
      ? { parentMandateId: options.parentMandateId }
      : {}),
    ...(options.parentMandateUid
      ? { parentMandateUid: options.parentMandateUid }
      : {}),
    ...(options.delegatedBy ? { delegatedBy: options.delegatedBy } : {}),
    ...(options.delegationPath ? { delegationPath: options.delegationPath } : {}),
    ...(options.delegationUids ? { delegationUids: options.delegationUids } : {}),
    ...(options.maxLeaseExpiresAt
      ? { maxLeaseExpiresAt: options.maxLeaseExpiresAt }
      : {}),
    repoPath: options.repoPath,
    worktreePath: options.worktreePath,
    branch: options.branch,
    agentRole: options.agentRole,
    profiles: options.profiles,
    lease: options.lease,
    createdAt: createdAt.toISOString(),
    expiresAt,
    allowedTools: options.allowedTools,
    deniedTools: options.deniedTools,
    approvalGates: options.approvalGates,
    ...(options.createdBy ? { createdBy: options.createdBy } : {}),
    ...(options.authoritySource
      ? { authoritySource: options.authoritySource }
      : {}),
    policyHash: computeMandatePolicyHash({
      profiles: options.profiles,
      allowedTools: options.allowedTools,
      deniedTools: options.deniedTools,
      approvalGates: options.approvalGates
    }),
    leaseEvents: [
      {
        type: "created",
        at: createdAt.toISOString(),
        lease: options.lease,
        expiresAt,
        ...(options.createdBy ? { actor: options.createdBy } : {})
      }
    ],
    handoffState: "open"
  };
}

function validateChildMandateScope(
  child: NormalizedCreateMandateOptions,
  parent: MandateWithStatus,
  createdAt: Date
): void {
  if (child.repoPath !== parent.repoPath) {
    throw new Error("child mandate repo must match parent mandate repo");
  }
  if (child.worktreePath !== parent.worktreePath) {
    throw new Error("child mandate worktree must match parent mandate worktree");
  }
  if (child.branch !== parent.branch) {
    throw new Error("child mandate branch must match parent mandate branch");
  }

  const parentProfiles = new Set(parent.profiles);
  const missingProfiles = child.profiles.filter(
    (profile) => !parentProfiles.has(profile)
  );
  if (missingProfiles.length > 0) {
    throw new Error(
      `child mandate profiles exceed parent scope: ${missingProfiles.join(", ")}`
    );
  }

  const maxLeaseExpiresAt = parent.maxLeaseExpiresAt ?? parent.expiresAt;
  const childExpiresAt = new Date(createdAt.getTime() + child.leaseMs);
  if (childExpiresAt.getTime() > Date.parse(maxLeaseExpiresAt)) {
    throw new Error("child mandate lease cannot outlive parent mandate lease");
  }

  if (
    child.allowedTools.length > 0 &&
    !toolPatternsWithinParent(child.allowedTools, parent.allowedTools)
  ) {
    throw new Error("child mandate allowed tools exceed parent tool scope");
  }
}

function toolPatternsWithinParent(
  childPatterns: string[],
  parentPatterns: string[]
): boolean {
  if (parentPatterns.length === 0) {
    return true;
  }

  return childPatterns.every((childPattern) =>
    parentPatterns.some((parentPattern) =>
      childToolPatternWithinParent(childPattern, parentPattern)
    )
  );
}

function childToolPatternWithinParent(
  childPattern: string,
  parentPattern: string
): boolean {
  if (parentPattern === "*" || childPattern === parentPattern) {
    return true;
  }

  if (parentPattern.endsWith("*")) {
    const parentPrefix = parentPattern.slice(0, -1);
    return childPattern.startsWith(parentPrefix);
  }

  return false;
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

function normalizeOptionalText(
  value: string | undefined,
  label: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (hasControlCharacters(trimmed)) {
    throw new Error(`${label} must not contain control characters`);
  }

  return trimmed;
}

function normalizeOptionalList(values: string[], label: string): string[] {
  const normalized = uniqueTrimmed(values);
  const invalid = normalized.find((value) => hasControlCharacters(value));
  if (invalid) {
    throw new Error(`${label} must not contain control characters`);
  }

  return normalized;
}

function normalizeApprovalGates(
  gates: Array<string | CreateMandateApprovalGate>,
  idOffset = 0
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
        ? `gate-${idOffset + result.length + 1}`
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

function lastMatchingApprovalGate(
  gates: MandateApprovalGate[],
  toolName: string
): MandateApprovalGate | undefined {
  for (let index = gates.length - 1; index >= 0; index -= 1) {
    const gate = gates[index];
    if (gate && toolPatternToRegExp(gate.toolPattern).test(toolName)) {
      return gate;
    }
  }

  return undefined;
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
