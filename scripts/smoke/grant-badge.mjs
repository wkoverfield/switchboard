#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)), "..");
const cliPath = resolve(repoRoot, "apps", "cli", "dist", "index.js");
const project = mkdtempSync(join(tmpdir(), "switchboard-grant-smoke-"));
const stateRoot = join(project, "state");

try {
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");
  writeFileSync(
    join(project, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_app:",
      "    provider: generic",
      "    namespace: github_app",
      "  vercel_app:",
      "    provider: generic",
      "    namespace: vercel_app"
    ].join("\n")
  );

  const granted = runJson("grant", "--for", "2h", "--json");
  assert(granted.mandate?.id === "grant-main", "expected grant-main pass id");
  assert(
    granted.mandate?.allowedTools?.join(",") === "github_app_*,vercel_app_*",
    "expected pass scoped to profile namespaces"
  );
  assert(granted.mandate?.lease === "2h", "expected 2h lease");
  assert(
    granted.workspaceLease?.schemaVersion === "switchboard.workspace-lease.v1",
    "expected workspace-lease contract"
  );

  const humanBadge = run("grant", "--for", "1h");
  assert(
    humanBadge.status !== 0 &&
      /already has an active pass/.test(humanBadge.stdout + humanBadge.stderr),
    "expected a second grant to be refused while one is active"
  );

  const revoked = run("revoke");
  assert(
    revoked.status === 0 && /Revoked the pass/.test(revoked.stdout),
    "expected revoke to free the active pass"
  );

  const regranted = run("grant", "--for", "30m");
  assert(
    regranted.status === 0 && /PASS GRANTED/.test(regranted.stdout),
    "expected grant to succeed again after revoke"
  );
} finally {
  rmSync(project, { force: true, recursive: true });
}

function run(...args) {
  return spawnSync(process.execPath, [cliPath, "--cwd", project, ...args], {
    encoding: "utf8",
    env: { ...process.env, XDG_STATE_HOME: stateRoot }
  });
}

function runJson(...args) {
  const result = run(...args);
  if (result.status !== 0) {
    throw new Error(
      `switchboard ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return JSON.parse(result.stdout);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
