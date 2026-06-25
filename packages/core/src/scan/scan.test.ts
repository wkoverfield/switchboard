import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanSwitchboardProject } from "./scan.js";

describe("switchboard project scan", () => {
  it("detects git repo, provider hints, env names, and redacts env values", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-scan-"));
    const homeDir = await mkdtemp(join(tmpdir(), "switchboard-scan-home-"));
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["checkout", "-b", "feature/scan"], {
      cwd: root,
      stdio: "ignore"
    });
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/wkoverfield/stockr.git"],
      { cwd: root, stdio: "ignore" }
    );
    await writeFile(
      join(root, ".env.local"),
      [
        "STRIPE_SECRET_KEY=sk_live_should_not_print",
        "NEXT_PUBLIC_POSTHOG_KEY=phc_should_not_print",
        "VERCEL_TOKEN=vercel_should_not_print"
      ].join("\n"),
      "utf8"
    );
    await mkdir(join(root, ".vercel"), { recursive: true });
    await writeFile(
      join(root, ".vercel", "project.json"),
      JSON.stringify({
        projectId: "prj_should_not_print",
        orgId: "team_should_not_print"
      }),
      "utf8"
    );

    const result = await scanSwitchboardProject({ cwd: root, homeDir });
    const serialized = JSON.stringify(result);

    expect(result.schemaVersion).toBe("switchboard.scan.v1");
    expect(result.repo.remote).toMatchObject({
      provider: "github",
      owner: "wkoverfield",
      repo: "stockr"
    });
    expect(result.repo.branch).toBe("feature/scan");
    expect(result.providers.map((provider) => provider.provider)).toEqual([
      "github",
      "posthog",
      "stripe",
      "vercel"
    ]);
    expect(
      result.providers.find((provider) => provider.provider === "stripe")?.envVars
    ).toEqual(["STRIPE_SECRET_KEY"]);
    expect(result.runtime.vercelProjectPresent).toBe(true);
    expect(result.nextActions).toContain("switchboard setup github-ci");
    expect(result.nextActions).toContain("switchboard setup vercel-preview");
    expect(serialized).not.toContain("sk_live_should_not_print");
    expect(serialized).not.toContain("phc_should_not_print");
    expect(serialized).not.toContain("vercel_should_not_print");
    expect(serialized).not.toContain("prj_should_not_print");
    expect(serialized).not.toContain("team_should_not_print");
  });

  it("reports configured Switchboard profiles and avoids duplicate provider setup", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-scan-config-"));
    const homeDir = await mkdtemp(join(tmpdir(), "switchboard-scan-home-"));
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync(
      "git",
      ["remote", "add", "origin", "git@github.com:wkoverfield/switchboard.git"],
      { cwd: root, stdio: "ignore" }
    );
    await writeFile(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_ci:",
        "    provider: github",
        "    namespace: github_ci",
        "    upstream:",
        "      type: stdio",
        "      command: docker",
        "workspaces:",
        "  default:",
        "    paths:",
        "      - .",
        "    profiles:",
        "      - github_ci"
      ].join("\n"),
      "utf8"
    );

    const result = await scanSwitchboardProject({ cwd: root, homeDir });

    expect(result.switchboard.profileNames).toEqual(["github_ci"]);
    expect(result.switchboard.workspaceNames).toEqual(["default"]);
    expect(result.nextActions).not.toContain("switchboard setup github-ci");
    expect(result.nextActions).toContain("switchboard install codex --write");
    expect(result.nextActions).toContain("switchboard install claude --write");
    expect(result.nextActions).toContain(
      "switchboard mandate create --from github-ci"
    );
  });

  it("redacts credentials embedded in git remote URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-scan-remote-"));
    const homeDir = await mkdtemp(join(tmpdir(), "switchboard-scan-home-"));
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync(
      "git",
      [
        "remote",
        "add",
        "origin",
        "https://ghp_should_not_print@github.com/wkoverfield/private.git?token=ghp_query_should_not_print#ghp_fragment_should_not_print"
      ],
      { cwd: root, stdio: "ignore" }
    );

    const result = await scanSwitchboardProject({ cwd: root, homeDir });
    const serialized = JSON.stringify(result);

    expect(result.repo.remote).toMatchObject({
      url: "https://github.com/wkoverfield/private.git",
      owner: "wkoverfield",
      repo: "private"
    });
    expect(serialized).not.toContain("ghp_should_not_print");
    expect(serialized).not.toContain("ghp_query_should_not_print");
    expect(serialized).not.toContain("ghp_fragment_should_not_print");
  });

  it("suggests mandate presets for configured provider profiles", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-scan-vercel-"));
    const homeDir = await mkdtemp(join(tmpdir(), "switchboard-scan-home-"));
    await writeFile(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  vercel_preview:",
        "    provider: vercel",
        "    namespace: vercel_preview",
        "    upstream:",
        "      type: stdio",
        "      command: vercel"
      ].join("\n"),
      "utf8"
    );

    const result = await scanSwitchboardProject({ cwd: root, homeDir });

    expect(result.nextActions).toContain(
      "switchboard mandate create --from vercel-preview"
    );
    expect(result.nextActions).not.toContain(
      "switchboard mandate create --from github-ci"
    );
  });
});
