import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  deletePassword,
  diagnose as diagnoseKeychain,
  getPassword,
  setPassword
} from "cross-keychain";
import type { PathResolutionOptions } from "../config/paths.js";
import type { SwitchboardConfig, UpstreamEnvValue } from "../schemas/config.js";
import {
  assertValidSecretRef,
  isSecretRefValue,
  validateSecretRef
} from "./secret-refs.js";

export const switchboardSecretServiceName = "switchboard-mcp";

export interface SecretStore {
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
  diagnose?(): Promise<Record<string, unknown>>;
}

export interface KeychainSecretStoreOptions {
  serviceName?: string;
}

export interface SecretRefUsage {
  ref: string;
  profileName: string;
  envName: string;
  path: string;
}

export interface MissingSecretRef {
  ref: string;
  usages: SecretRefUsage[];
  status: "missing" | "error";
  message: string;
}

export interface SecretIndexEntry {
  ref: string;
  updatedAt: string;
}

export interface SecretIndex {
  version: 1;
  refs: SecretIndexEntry[];
}

export interface SecretIndexOptions extends PathResolutionOptions {
  path?: string;
}

export function createKeychainSecretStore(
  options: KeychainSecretStoreOptions = {}
): SecretStore {
  const serviceName = options.serviceName ?? switchboardSecretServiceName;
  return {
    async get(ref) {
      assertValidSecretRef(ref);
      return withSuppressedKeychainWarnings(() =>
        getPassword(serviceName, keychainAccountForSecretRef(ref))
      );
    },
    async set(ref, value) {
      assertValidSecretRef(ref);
      await withSuppressedKeychainWarnings(() =>
        setPassword(serviceName, keychainAccountForSecretRef(ref), value)
      );
    },
    async delete(ref) {
      assertValidSecretRef(ref);
      await withSuppressedKeychainWarnings(() =>
        deletePassword(serviceName, keychainAccountForSecretRef(ref))
      );
    },
    diagnose: () => withSuppressedKeychainWarnings(diagnoseKeychain)
  };
}

export function keychainAccountForSecretRef(ref: string): string {
  assertValidSecretRef(ref);
  return `switchboard_${Buffer.from(ref, "utf8").toString("base64url")}`;
}

async function withSuppressedKeychainWarnings<T>(
  operation: () => Promise<T>
): Promise<T> {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return await operation();
  } finally {
    console.warn = originalWarn;
  }
}

export function createMemorySecretStore(
  initial: Record<string, string> = {}
): SecretStore {
  const values = new Map(Object.entries(initial));
  return {
    async get(ref) {
      assertValidSecretRef(ref);
      return values.get(ref) ?? null;
    },
    async set(ref, value) {
      assertValidSecretRef(ref);
      values.set(ref, value);
    },
    async delete(ref) {
      assertValidSecretRef(ref);
      values.delete(ref);
    },
    async diagnose() {
      return { backend: "memory", count: values.size };
    }
  };
}

export function resolveSecretIndexPath(
  options: SecretIndexOptions = {}
): string {
  if (options.path) {
    return options.path;
  }

  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const stateRoot = env.XDG_STATE_HOME
    ? resolve(env.XDG_STATE_HOME)
    : join(home, ".local", "state");

  return join(stateRoot, "switchboard", "secrets", "index.json");
}

export async function readSecretIndex(
  options: SecretIndexOptions = {}
): Promise<SecretIndex> {
  const path = resolveSecretIndexPath(options);
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return "";
    }
    throw error;
  });

  if (raw.trim().length === 0) {
    return { version: 1, refs: [] };
  }

  const parsed = JSON.parse(raw) as Partial<SecretIndex>;
  return {
    version: 1,
    refs: Array.isArray(parsed.refs)
      ? parsed.refs
          .filter(
            (entry): entry is SecretIndexEntry =>
              typeof entry?.ref === "string" &&
              typeof entry.updatedAt === "string" &&
              validateSecretRef(entry.ref).ok
          )
          .sort((a, b) => a.ref.localeCompare(b.ref))
      : []
  };
}

export async function listSecretRefs(
  options: SecretIndexOptions = {}
): Promise<SecretIndexEntry[]> {
  return (await readSecretIndex(options)).refs;
}

export async function rememberSecretRef(
  ref: string,
  options: SecretIndexOptions = {}
): Promise<SecretIndex> {
  assertValidSecretRef(ref);
  const index = await readSecretIndex(options);
  const updatedAt = new Date().toISOString();
  const refs = [
    ...index.refs.filter((entry) => entry.ref !== ref),
    { ref, updatedAt }
  ].sort((a, b) => a.ref.localeCompare(b.ref));
  const next: SecretIndex = { version: 1, refs };
  await writeSecretIndex(next, options);
  return next;
}

export async function forgetSecretRef(
  ref: string,
  options: SecretIndexOptions = {}
): Promise<SecretIndex> {
  assertValidSecretRef(ref);
  const index = await readSecretIndex(options);
  const next: SecretIndex = {
    version: 1,
    refs: index.refs.filter((entry) => entry.ref !== ref)
  };
  await writeSecretIndex(next, options);
  return next;
}

export function collectSecretRefUsages(
  config: SwitchboardConfig
): SecretRefUsage[] {
  const usages: SecretRefUsage[] = [];
  for (const [profileName, profile] of Object.entries(config.profiles)) {
    const env = profile.upstream?.env;
    if (!env) {
      continue;
    }

    for (const [envName, value] of Object.entries(env)) {
      if (isSecretRefValue(value)) {
        usages.push({
          ref: value.secretRef,
          profileName,
          envName,
          path: `profiles.${profileName}.upstream.env.${envName}.secretRef`
        });
      }
    }
  }

  return usages;
}

export async function findMissingSecretRefs(
  config: SwitchboardConfig,
  store: SecretStore
): Promise<MissingSecretRef[]> {
  const usagesByRef = new Map<string, SecretRefUsage[]>();
  for (const usage of collectSecretRefUsages(config)) {
    const usages = usagesByRef.get(usage.ref) ?? [];
    usages.push(usage);
    usagesByRef.set(usage.ref, usages);
  }

  const missing: MissingSecretRef[] = [];
  for (const [ref, usages] of usagesByRef) {
    try {
      if ((await store.get(ref)) === null) {
        missing.push({
          ref,
          usages,
          status: "missing",
          message: `secretRef "${ref}" is not set`
        });
      }
    } catch (error) {
      missing.push({
        ref,
        usages,
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return missing.sort((a, b) => a.ref.localeCompare(b.ref));
}

export async function resolveEnvSecretRefs(
  env: Record<string, UpstreamEnvValue>,
  store: SecretStore
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      resolved[key] = value;
      continue;
    }

    if (isSecretRefValue(value)) {
      const secret = await store.get(value.secretRef);
      if (secret === null) {
        throw new Error(
          `secretRef "${value.secretRef}" for env ${key} is not set`
        );
      }
      resolved[key] = secret;
    }
  }

  return resolved;
}

async function writeSecretIndex(
  index: SecretIndex,
  options: SecretIndexOptions
): Promise<void> {
  const path = resolveSecretIndexPath(options);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(index, null, 2)}\n`, {
    mode: 0o600
  });
  await chmod(tempPath, 0o600);
  await rename(tempPath, path);
  await chmod(path, 0o600);
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export async function removeSecretIndex(
  options: SecretIndexOptions = {}
): Promise<void> {
  await unlink(resolveSecretIndexPath(options)).catch((error: unknown) => {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  });
}
