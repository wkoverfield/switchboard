#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const repo = resolve(import.meta.dirname, "..", "..");
const cliPath = join(repo, "apps/cli/dist/index.js");
const project = mkdtempSync(join(tmpdir(), "switchboard-repo-manifest-"));

try {
  run("git", ["init", "-b", "main"], { cwd: project });
  mkdirSync(join(project, ".codex"), { recursive: true });
  writeFileSync(
    join(project, ".codex", "config.toml"),
    [
      "[mcp_servers.github]",
      'command = "docker"',
      'args = ["run", "GITHUB_TOKEN=ghp_manifest_smoke_should_not_print"]'
    ].join("\n")
  );
  writeFileSync(
    join(project, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_ci:",
      "    provider: github",
      "    namespace: github_ci",
      "    upstream:",
      "      type: stdio",
      "      command: node",
      "      env:",
      "        GITHUB_TOKEN:",
      "          secretRef: github/example/dev/token"
    ].join("\n")
  );

  const manifest = runCliJson(["manifest", "--json"]);
  assert(manifest.schemaVersion === "switchboard.repo-manifest.v1", "schema");
  assert(manifest.authorityStatus?.status === "bypass-present", "authority");
  assert(manifest.audit?.status === "unsafe", "audit");
  assert(
    manifest.profiles?.some(
      (profile) =>
        profile.name === "github_ci" &&
        profile.secretRefs?.includes("github/example/dev/token")
    ),
    "profile secret ref"
  );
  assert(
    manifest.clients?.some(
      (client) =>
        client.client === "codex" &&
        client.directServerNames?.includes("github") &&
        client.rendered?.content?.includes("--cwd")
    ),
    "codex manifest"
  );
  assert(
    manifest.clients?.some(
      (client) =>
        client.client === "claude" &&
        client.rendered?.content?.includes('"mcpServers"')
    ),
    "claude manifest"
  );
  assert(
    JSON.stringify(manifest).includes("switchboard install codex --write"),
    "install command"
  );
  assert(
    !JSON.stringify(manifest).includes("ghp_manifest_smoke_should_not_print"),
    "redacted manifest"
  );

  const human = runCli(["manifest"]);
  assert(human.stdout.includes("Switchboard repo manifest:"), "human title");
  assert(human.stdout.includes("Profiles:"), "human profiles");
  assert(human.stdout.includes("Clients:"), "human clients");
  assert(
    !human.stdout.includes("ghp_manifest_smoke_should_not_print"),
    "redacted human"
  );
} finally {
  rmSync(project, { force: true, recursive: true });
}

function runCliJson(args) {
  const result = runCli(args);
  if (result.status !== 0) {
    throw new Error(
      `switchboard ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return JSON.parse(result.stdout);
}

function runCli(args) {
  return run(process.execPath, [cliPath, "--cwd", project, ...args], {
    cwd: repo,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(project, "xdg-config"),
      XDG_DATA_HOME: join(project, "xdg-data"),
      XDG_STATE_HOME: join(project, "xdg-state"),
      TS_KEYRING_BACKEND: "file",
      SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS: "1"
    },
    timeout: 120_000
  });
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
}
