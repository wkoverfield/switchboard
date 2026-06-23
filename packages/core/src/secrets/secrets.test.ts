import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { switchboardConfigSchema } from "../schemas/config.js";
import {
  collectSecretRefUsages,
  createMemorySecretStore,
  findMissingSecretRefs,
  forgetSecretRef,
  listSecretRefs,
  keychainAccountForSecretRef,
  rememberSecretRef,
  resolveEnvSecretRefs,
  resolveSecretIndexPath
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
});
