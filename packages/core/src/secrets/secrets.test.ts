import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { switchboardConfigSchema } from "../schemas/config.js";
import {
  allowUnsafeSecretBackendsEnv,
  allowedKeychainBackendIds,
  collectSecretRefUsages,
  createMemorySecretStore,
  crossKeychainBackendEnv,
  defaultAllowedKeychainBackendIds,
  describeSecretBackendError,
  diagnoseKeychainBackendPolicy,
  findMissingSecretRefs,
  forgetSecretRef,
  isAllowedKeychainBackendId,
  listSecretRefs,
  keychainAccountForSecretRef,
  probeSecretStore,
  rememberSecretRef,
  resolveEnvSecretRefs,
  resolveSecretIndexPath,
  secretStoreProbeRef,
  type SecretStore,
  unsafeKeychainBackendIds
} from "./secrets.js";
import { validateSecretRef } from "./secret-refs.js";

describe("secret refs", () => {
  it("validates path-like refs", () => {
    expect(validateSecretRef("github/findu/dev/token")).toMatchObject({
      ok: true
    });
    expect(validateSecretRef("GitHub/findu/dev/token")).toMatchObject({
      ok: false
    });
    expect(validateSecretRef("github//token")).toMatchObject({ ok: false });
  });

  it("maps refs to keychain-safe account names", () => {
    expect(keychainAccountForSecretRef("github/findu/dev/token")).toMatch(
      /^switchboard_[A-Za-z0-9_-]+$/
    );
    expect(keychainAccountForSecretRef("github/findu/dev/token")).not.toContain(
      "/"
    );
  });

  it("allows only OS-protected keychain backends by default", () => {
    expect(allowedKeychainBackendIds()).toEqual([
      ...defaultAllowedKeychainBackendIds
    ]);
    expect(isAllowedKeychainBackendId("native-macos")).toBe(true);
    expect(isAllowedKeychainBackendId("native-linux")).toBe(true);
    expect(isAllowedKeychainBackendId("secret-service")).toBe(false);
    expect(isAllowedKeychainBackendId("file")).toBe(false);
    expect(isAllowedKeychainBackendId("null")).toBe(false);
    expect(isAllowedKeychainBackendId("macos")).toBe(false);
    expect(isAllowedKeychainBackendId("windows")).toBe(false);
  });

  it("requires explicit Switchboard opt-in for unsafe secret backends", () => {
    const options = {
      env: { [allowUnsafeSecretBackendsEnv]: "1" } as NodeJS.ProcessEnv
    };

    expect(allowedKeychainBackendIds(options)).toEqual([
      ...defaultAllowedKeychainBackendIds,
      ...unsafeKeychainBackendIds
    ]);
    expect(isAllowedKeychainBackendId("file", options)).toBe(true);
    expect(isAllowedKeychainBackendId("null", options)).toBe(true);
  });

  it("explains rejected dependency-requested unsafe backends", async () => {
    await expect(
      diagnoseKeychainBackendPolicy({
        env: {
          [crossKeychainBackendEnv]: "file"
        } as NodeJS.ProcessEnv
      })
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining(
        `Switchboard refused keychain backend "file"`
      )
    });

    await expect(
      diagnoseKeychainBackendPolicy({
        env: {
          [crossKeychainBackendEnv]: "secret-service"
        } as NodeJS.ProcessEnv
      })
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining(
        `Switchboard refused keychain backend "secret-service"`
      )
    });
  });

  it("parses upstream env secret refs in config", () => {
    const parsed = switchboardConfigSchema.parse({
      version: 1,
      profiles: {
        github_findu: {
          provider: "generic",
          upstream: {
            type: "stdio",
            command: "github-mcp-server",
            env: {
              GITHUB_TOKEN: {
                secretRef: "github/findu/dev/token"
              },
              LOG_LEVEL: "debug"
            }
          }
        }
      }
    });

    expect(
      parsed.profiles.github_findu?.upstream?.env?.GITHUB_TOKEN
    ).toEqual({
      secretRef: "github/findu/dev/token"
    });
  });

  it("rejects invalid secret refs in config", () => {
    const parsed = switchboardConfigSchema.safeParse({
      version: 1,
      profiles: {
        github_findu: {
          provider: "generic",
          upstream: {
            type: "stdio",
            command: "github-mcp-server",
            env: {
              GITHUB_TOKEN: {
                secretRef: "Github Token"
              }
            }
          }
        }
      }
    });

    expect(parsed.success).toBe(false);
  });

  it("resolves secret refs while preserving literal env values", async () => {
    const store = createMemorySecretStore({
      "github/findu/dev/token": "ghp_secret"
    });

    await expect(
      resolveEnvSecretRefs(
        {
          GITHUB_TOKEN: { secretRef: "github/findu/dev/token" },
          LOG_LEVEL: "debug"
        },
        store
      )
    ).resolves.toEqual({
      GITHUB_TOKEN: "ghp_secret",
      LOG_LEVEL: "debug"
    });
  });

  it("reports missing configured secret refs without values", async () => {
    const config = switchboardConfigSchema.parse({
      version: 1,
      profiles: {
        github_findu: {
          provider: "generic",
          upstream: {
            type: "stdio",
            command: "github-mcp-server",
            env: {
              GITHUB_TOKEN: {
                secretRef: "github/findu/dev/token"
              }
            }
          }
        }
      }
    });

    expect(collectSecretRefUsages(config)).toMatchObject([
      {
        ref: "github/findu/dev/token",
        profileName: "github_findu",
        envName: "GITHUB_TOKEN"
      }
    ]);
    await expect(
      findMissingSecretRefs(config, createMemorySecretStore())
    ).resolves.toMatchObject([
      {
        ref: "github/findu/dev/token",
        status: "missing"
      }
    ]);
  });

  it("maintains a value-free secret ref index", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-secrets-"));
    const path = join(root, "state", "index.json");

    await rememberSecretRef("vercel/findu/preview/token", { path });
    await rememberSecretRef("github/findu/dev/token", { path });

    expect(await listSecretRefs({ path })).toEqual([
      expect.objectContaining({ ref: "github/findu/dev/token" }),
      expect.objectContaining({ ref: "vercel/findu/preview/token" })
    ]);
    expect(await readFile(path, "utf8")).not.toContain("secret");
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    await forgetSecretRef("github/findu/dev/token", { path });
    expect(await listSecretRefs({ path })).toEqual([
      expect.objectContaining({ ref: "vercel/findu/preview/token" })
    ]);
  });

  it("resolves the XDG state secret index path", () => {
    expect(
      resolveSecretIndexPath({
        env: { XDG_STATE_HOME: "/state" } as NodeJS.ProcessEnv,
        homeDir: "/home/alex"
      })
    ).toBe("/state/switchboard/secrets/index.json");
  });

  it("probes a healthy store with a round-trip and cleans up", async () => {
    const store = createMemorySecretStore();
    const probe = await probeSecretStore(store);
    expect(probe).toEqual({ ok: true });
    expect(await store.get(secretStoreProbeRef)).toBeNull();
  });

  it("preserves a real value that already lives at the probe ref", async () => {
    const store = createMemorySecretStore({
      [secretStoreProbeRef]: "someone-really-stored-this"
    });
    const probe = await probeSecretStore(store);
    expect(probe).toEqual({ ok: true });
    expect(await store.get(secretStoreProbeRef)).toBe(
      "someone-really-stored-this"
    );
  });

  it("reports a probe failure when the backend cannot write", async () => {
    const failing: SecretStore = {
      get: async () => null,
      set: async () => {
        throw new Error("Unsupported state or unable to authenticate data");
      },
      delete: async () => {}
    };
    const probe = await probeSecretStore(failing);
    expect(probe.ok).toBe(false);
    expect(probe.error).toContain("unable to authenticate data");
  });

  it("reports a probe failure when the read-back value does not match", async () => {
    const lying: SecretStore = {
      get: async () => "something-else",
      set: async () => {},
      delete: async () => {}
    };
    const probe = await probeSecretStore(lying);
    expect(probe.ok).toBe(false);
    expect(probe.error).toContain("different value");
  });

  it("explains an undecryptable file vault with a recovery path", () => {
    const help = describeSecretBackendError(
      new Error("Unsupported state or unable to authenticate data"),
      {
        env: { [crossKeychainBackendEnv]: "file" } as NodeJS.ProcessEnv,
        backendId: "file",
        dataRoot: "/home/alex/.local/share/keyring",
        configPath: "/home/alex/.config/keyring/keyring.config.json"
      }
    );
    expect(help.summary).toContain("cannot decrypt its saved vault");
    expect(help.nextActions.join("\n")).toContain(crossKeychainBackendEnv);
    expect(help.nextActions.join("\n")).toContain(
      "/home/alex/.local/share/keyring"
    );
    expect(help.nextActions.join("\n")).toContain("secrets doctor");
  });

  it("passes Switchboard's own backend refusal through unchanged", () => {
    const help = describeSecretBackendError(
      new Error('Switchboard refused keychain backend "file" for local secrets.')
    );
    expect(help.summary).toContain("refused keychain backend");
    expect(help.nextActions).toEqual([]);
  });

  it("falls back to a generic backend message for unknown errors", () => {
    const help = describeSecretBackendError(new Error("socket hang up"), {
      backendId: "native-macos"
    });
    expect(help.summary).toContain("native-macos");
    expect(help.detail).toBe("socket hang up");
    expect(help.nextActions).toContain(
      "Run switchboard secrets doctor to check the backend."
    );
  });
});
