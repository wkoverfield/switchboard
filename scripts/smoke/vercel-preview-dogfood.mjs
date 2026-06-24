#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const repo = resolve(import.meta.dirname, "..", "..");
const cliPath = join(repo, "apps/cli/dist/index.js");
const fixtureServerPath = join(
  repo,
  "packages/mcp-runtime/fixtures/echo-server.mjs"
);
const project = mkdtempSync(join(tmpdir(), "switchboard-vercel-preview-"));
const secretRef = "vercel/example/preview/token";
const secretValue = "vercel-preview-secret-do-not-print";
const secretHash = sha256(secretValue);

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:vercel-preview-dogfood`."
  );
}

try {
  run("git", ["init", "-b", "preview"], { cwd: project });
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");

  const add = runCliJson(
    "add",
    "vercel-preview",
    "--command",
    process.execPath,
    "--arg",
    fixtureServerPath,
    "--arg",
    "vercel_preview",
    "--arg",
    "VERCEL_TOKEN",
    "--arg",
    secretHash,
    "--write",
    "--json"
  );
  assert(add.action === "created", "expected vercel preview add to create config");
  assert(
    add.commands?.mandateCreate?.args?.includes?.("--from"),
    "expected structured mandate create command"
  );
  assertNoSecretText(JSON.stringify(add), "provider add");

  const setSecret = runCli(
    ["secrets", "set", secretRef, "--value-stdin", "--json"],
    secretValue
  );
  assert(setSecret.status === 0, "expected secret set to succeed");
  assertNoSecretLeak(setSecret, "secret set");

  const mandate = runCliJson(
    "mandate",
    "create",
    "--from",
    "vercel-preview",
    "--json"
  );
  assert(mandate.mandate?.id === "inspect-preview", "expected template task id");
  assert(mandate.mandate?.branch === "preview", "expected current branch");
  assert(
    mandate.mandate?.deniedTools?.includes?.("vercel_preview_deploy_prod"),
    "expected production deploy denied"
  );
  assert(
    mandate.mandate?.approvalGates?.some?.(
      (gate) => gate.toolPattern === "vercel_preview_*deploy*"
    ),
    "expected deploy approval gate"
  );
  assertNoSecretText(JSON.stringify(mandate), "mandate create");

  const tools = runCliJson("tools", "--mandate", "inspect-preview", "--json");
  assert(
    tools.tools?.some?.((tool) => tool.name === "vercel_preview_echo"),
    "expected preview tool surface"
  );
  assertNoSecretText(JSON.stringify(tools), "tool surface");

  const report = runCliJson("mandate", "report", "inspect-preview", "--json");
  assert(
    report.readiness?.selectedCanHandoff === true,
    "expected preview mandate ready for handoff"
  );
  assertNoSecretText(JSON.stringify(report), "mandate report");
} finally {
  runCli(["secrets", "remove", secretRef], undefined, { allowFailure: true });
  rmSync(project, { force: true, recursive: true });
}

function runCliJson(...args) {
  const result = runCli(args);
  if (result.status !== 0) {
    throw new Error(
      `switchboard ${args.join(" ")} failed\nstdout:\n${redactSecret(result.stdout)}\nstderr:\n${redactSecret(result.stderr)}`
    );
  }
  assertNoSecretLeak(result, `switchboard ${args.join(" ")}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function runCli(args, input, options = {}) {
  const result = run(process.execPath, [cliPath, "--cwd", project, ...args], {
    cwd: repo,
    input,
    env: smokeEnv()
  });
  if (!options.allowFailure && result.status !== 0) {
    return result;
  }
  return result;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options
  });
}

function smokeEnv() {
  return {
    ...process.env,
    XDG_CONFIG_HOME: join(project, "xdg-config"),
    XDG_DATA_HOME: join(project, "xdg-data"),
    XDG_STATE_HOME: join(project, "xdg-state"),
    TS_KEYRING_BACKEND: "file",
    SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS: "1"
  };
}

function assertNoSecretLeak(result, label) {
  assertNoSecretText(result.stdout, `${label} stdout`);
  assertNoSecretText(result.stderr, `${label} stderr`);
}

function assertNoSecretText(value, label) {
  assert(!value.includes(secretValue), `${label} printed secret value`);
}

function redactSecret(value) {
  return value.replaceAll(secretValue, "[redacted]");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
