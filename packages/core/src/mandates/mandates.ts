import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PathResolutionOptions } from "../config/paths.js";

export type MandateRuntimeStatus = "active" | "expired";

export interface Mandate {
  version: 1;
  id: string;
  task: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  agentRole: string;
  profiles: string[];
  lease: string;
  createdAt: string;
  expiresAt: string;
  allowedTools: string[];
  deniedTools: string[];
  approvalGates: string[];
  handoffState: "open";
}

export interface MandateWithStatus extends Mandate {
  runtimeStatus: MandateRuntimeStatus;
}

export interface MandateStore {
  version: 1;
  mandates: Mandate[];
}

export interface CreateMandateOptions {
  task: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  agentRole: string;
  profiles: string[];
  lease: string;
  path?: string;
  now?: () => Date;
}

export interface ListMandatesOptions {
  path?: string;
  repoPath?: string;
  id?: string;
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

  const leaseMs = parseMandateLease(options.lease);
  const repoPath = resolve(options.repoPath);
  const worktreePath = resolve(options.worktreePath);
  const pathOptions = options.path ? { path: options.path } : {};
  const store = await readMandateStore(pathOptions);
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
    allowedTools: [],
    deniedTools: [],
    approvalGates: [],
    handoffState: "open"
  };

  store.mandates.push(mandate);
  await writeMandateStore(store, pathOptions);

  return withRuntimeStatus(mandate, createdAt);
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

  const parsed = JSON.parse(raw) as MandateStore;
  if (parsed.version !== 1 || !Array.isArray(parsed.mandates)) {
    throw new Error(`invalid Switchboard mandate store at ${path}`);
  }

  return parsed;
}

async function writeMandateStore(
  store: MandateStore,
  options: { path?: string } = {}
): Promise<void> {
  const path = options.path ?? resolveMandateStorePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
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
