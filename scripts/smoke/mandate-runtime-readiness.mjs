#!/usr/bin/env node
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const repo = resolve(import.meta.dirname, "..", "..");
const cliPath = join(repo, "apps/cli/dist/index.js");
const project = mkdtempSync(join(tmpdir(), "switchboard-runtime-readiness-"));
const stateHome = join(project, ".state");

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:mandate-runtime-readiness`."
  );
}

try {
  run("git", ["init", "-b", "main"], { cwd: project });
  writeFileSync(
    join(project, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_runtime_ci:",
      "    provider: generic"
    ].join("\n")
  );

  const expired = runCliJson(
    "mandate",
    "create",
    "fix-ci",
    "--agent",
    "worker",
    "--profiles",
    "github_runtime_ci",
    "--branch",
    "main",
    "--lease",
    "1m",
    "--json"
  );
  assert(expired.mandate?.id === "fix-ci", "expected mandate creation");

  const storePath = join(stateHome, "switchboard", "mandates", "mandates.json");
  const store = JSON.parse(readText(storePath));
  store.mandates[0].createdAt = "2026-01-01T00:00:00.000Z";
  store.mandates[0].expiresAt = "2026-01-01T00:01:00.000Z";
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);

  const expiredStatus = runCliJson("mandate", "status", "fix-ci", "--json");
  assert(
    expiredStatus.readiness?.blockers?.includes?.('mandate "fix-ci" is expired'),
    "expected expired mandate blocker"
  );
  assert(
    expiredStatus.readiness?.nextActions?.includes?.(
      "switchboard mandate renew fix-ci --lease 1m"
    ),
    "expected renew next action"
  );

  const renewed = runCliJson(
    "mandate",
    "renew",
    "fix-ci",
    "--lease",
    "2h",
    "--json"
  );
  assert(renewed.mandate?.runtimeStatus === "active", "expected renewed mandate");

  run("git", ["switch", "-c", "other"], { cwd: project });
  const mismatch = runCliJson("mandate", "status", "fix-ci", "--json");
  assert(
    mismatch.readiness?.blockers?.some?.((blocker) =>
      blocker.includes('mandate "fix-ci" is scoped to branch "main"')
    ),
    "expected branch mismatch blocker"
  );
  assert(
    mismatch.readiness?.nextActions?.includes?.("git switch main"),
    "expected git switch recovery action"
  );
} finally {
  rmSync(project, { recursive: true, force: true });
}

function runCliJson(...args) {
  const result = run(process.execPath, [cliPath, "--cwd", project, ...args], {
    cwd: project,
    env: { ...process.env, XDG_STATE_HOME: stateHome }
  });
  return JSON.parse(result.stdout);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? project,
    env: options.env ?? process.env,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return result;
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
