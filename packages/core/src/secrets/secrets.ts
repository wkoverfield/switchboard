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
  initBackend,
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
  env?: NodeJS.ProcessEnv;
}

export const allowUnsafeSecretBackendsEnv =
  "SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS";
export const crossKeychainBackendEnv = "TS_KEYRING_BACKEND";

export const defaultAllowedKeychainBackendIds = [
  "native-macos",
  "native-windows",
  "native-linux"
] as const;

export const unsafeKeychainBackendIds = [
  "macos",
  "windows",
  "secret-service",
  "file",
  "null"
] as const;

export interface KeychainBackendPolicyDiagnostic extends Record<string, unknown> {
  ok: boolean;
  allowedBackendIds: string[];
  unsafeBackendsAllowed: boolean;
  backend?: Record<string, unknown>;
  message?: string;
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
  const ensureBackend = createKeychainBackendInitializer(options);
  return {
    async get(ref) {
      assertValidSecretRef(ref);
      await ensureBackend();
      return withSuppressedKeychainWarnings(() =>
        getPassword(serviceName, keychainAccountForSecretRef(ref))
      );
    },
    async set(ref, value) {
      assertValidSecretRef(ref);
      await ensureBackend();
      await withSuppressedKeychainWarnings(() =>
        setPassword(serviceName, keychainAccountForSecretRef(ref), value)
      );
    },
    async delete(ref) {
      assertValidSecretRef(ref);
      await ensureBackend();
      await withSuppressedKeychainWarnings(() =>
        deletePassword(serviceName, keychainAccountForSecretRef(ref))
      );
    },
    diagnose: () => diagnoseKeychainBackendPolicy(options)
  };
}

export async function diagnoseKeychainBackendPolicy(
  options: KeychainSecretStoreOptions = {}
): Promise<KeychainBackendPolicyDiagnostic> {
  const allowedBackendIds = allowedKeychainBackendIds(options);
  const unsafeBackendsAllowed = areUnsafeKeychainBackendsAllowed(options);
  try {
    await initializeKeychainBackend(options);
    const backend = await withSuppressedKeychainWarnings(diagnoseKeychain);
    return {
      ok: true,
      allowedBackendIds,
      unsafeBackendsAllowed,
      backend
    };
  } catch (error) {
    return {
      ok: false,
      allowedBackendIds,
      unsafeBackendsAllowed,
      message: messageFromUnknownError(error)
    };
  }
}

export function allowedKeychainBackendIds(
  options: KeychainSecretStoreOptions = {}
): string[] {
  return areUnsafeKeychainBackendsAllowed(options)
    ? [
        ...defaultAllowedKeychainBackendIds,
        ...unsafeKeychainBackendIds
      ]
    : [...defaultAllowedKeychainBackendIds];
}

export function isAllowedKeychainBackendId(
  backendId: string,
  options: KeychainSecretStoreOptions = {}
): boolean {
  return allowedKeychainBackendIds(options).includes(backendId);
}

function createKeychainBackendInitializer(
  options: KeychainSecretStoreOptions
): () => Promise<void> {
  let initialized = false;
  return async () => {
    if (initialized) {
      return;
    }
    await initializeKeychainBackend(options);
    initialized = true;
  };
}

async function initializeKeychainBackend(
  options: KeychainSecretStoreOptions
): Promise<void> {
  const allowedBackendIds = allowedKeychainBackendIds(options);
  assertRequestedKeychainBackendAllowed(options, allowedBackendIds);
  await withSuppressedKeychainWarnings(() =>
    initBackend((backend: { id: string }) =>
      allowedBackendIds.includes(backend.id)
    )
  );
  const backend = await withSuppressedKeychainWarnings(diagnoseKeychain);
  const backendId = typeof backend.id === "string" ? backend.id : "unknown";
  if (!allowedBackendIds.includes(backendId)) {
    throw new Error(
      [
        `Switchboard refused keychain backend "${backendId}" for local secrets.`,
        `Allowed backends: ${allowedBackendIds.join(", ")}.`,
        `Set ${allowUnsafeSecretBackendsEnv}=1 only for tests or local demos that intentionally use unsafe fallback storage.`
      ].join(" ")
    );
  }
}

function assertRequestedKeychainBackendAllowed(
  options: KeychainSecretStoreOptions,
  allowedBackendIds: string[]
): void {
  const requestedBackend = (options.env ?? process.env)[crossKeychainBackendEnv];
  if (requestedBackend && !allowedBackendIds.includes(requestedBackend)) {
    throw new Error(
      [
        `Switchboard refused keychain backend "${requestedBackend}" requested by ${crossKeychainBackendEnv} for local secrets.`,
        `Allowed backends: ${allowedBackendIds.join(", ")}.`,
        `Set ${allowUnsafeSecretBackendsEnv}=1 only for tests or local demos that intentionally use unsafe fallback storage.`
      ].join(" ")
    );
  }
}

function areUnsafeKeychainBackendsAllowed(
  options: KeychainSecretStoreOptions
): boolean {
  const value = (options.env ?? process.env)[allowUnsafeSecretBackendsEnv];
  return value === "1" || value === "true" || value === "yes";
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

function messageFromUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const secretStoreProbeRef = "switchboard/diagnostics/probe";
const secretStoreProbeValue = "switchboard-secret-store-probe";

export interface SecretStoreProbeResult {
  ok: boolean;
  error?: string;
}

/**
 * Round-trips a throwaway value through the store so a health check reflects
 * real read/write, not just backend initialization. Some backends init fine
 * but cannot decrypt an existing vault; only a round-trip surfaces that.
 */
export async function probeSecretStore(
  store: SecretStore
): Promise<SecretStoreProbeResult> {
  try {
    await store.set(secretStoreProbeRef, secretStoreProbeValue);
  } catch (error) {
    return { ok: false, error: messageFromUnknownError(error) };
  }

  try {
    const readBack = await store.get(secretStoreProbeRef);
    if (readBack !== secretStoreProbeValue) {
      return {
        ok: false,
        error: "the secret store returned a different value than was written"
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: messageFromUnknownError(error) };
  } finally {
    await store.delete(secretStoreProbeRef).catch(() => {});
  }
}

export interface SecretBackendErrorHelp {
  summary: string;
  detail?: string;
  nextActions: string[];
}

export interface SecretBackendErrorContext {
  env?: NodeJS.ProcessEnv;
  backendId?: string;
  dataRoot?: string;
  configPath?: string;
}

/**
 * Maps a raw secret-backend failure into a human-actionable message. The most
 * common opaque failure is a keyring vault that initializes but cannot be
 * decrypted (created by another user/machine, or with a different passphrase),
 * which surfaces as a bare "unable to authenticate data" crypto error.
 */
export function describeSecretBackendError(
  error: unknown,
  context: SecretBackendErrorContext = {}
): SecretBackendErrorHelp {
  const raw = messageFromUnknownError(error);
  const requestedBackend = (context.env ?? process.env)[crossKeychainBackendEnv];
  const backendLabel =
    context.backendId ?? requestedBackend ?? "your OS keychain";

  // Switchboard's own policy refusals already carry a clear message.
  if (/refused keychain backend/i.test(raw)) {
    return { summary: raw, nextActions: [] };
  }

  const looksUndecryptable =
    /unable to authenticate data|unsupported state|bad decrypt|wrong final block length|error:0[0-9a-f]+/i.test(
      raw
    );
  if (looksUndecryptable) {
    const nextActions: string[] = [];
    if (requestedBackend === "file" || context.backendId === "file") {
      nextActions.push(
        `Prefer your OS keychain: unset ${crossKeychainBackendEnv} and ${allowUnsafeSecretBackendsEnv}, then run the command again.`
      );
      if (context.dataRoot) {
        nextActions.push(
          `Or reset the fallback vault: remove ${context.dataRoot}${context.configPath ? ` and ${context.configPath}` : ""}, then run the command again.`
        );
      }
    }
    nextActions.push("Run switchboard secrets doctor to re-check the backend.");
    return {
      summary: `Your local secret store (${backendLabel}) started up but cannot decrypt its saved vault.`,
      detail:
        "The vault was most likely created by another user or machine, or with a different passphrase, so it cannot be unlocked here.",
      nextActions
    };
  }

  return {
    summary: `Your local secret store (${backendLabel}) could not complete that operation.`,
    detail: raw,
    nextActions: ["Run switchboard secrets doctor to check the backend."]
  };
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
