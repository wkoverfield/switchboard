#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const repo = resolve(packageDir, "..", "..");
const cliPath = join(repo, "apps/cli/dist/index.js");
const fixtureServerPath = join(packageDir, "fixtures", "echo-server.mjs");
const project = mkdtempSync(join(tmpdir(), "switchboard-github-ci-loop-"));
const secretRef = "github/example/dev/token";
const secretValue = "github-ci-loop-secret-do-not-print";
const secretHash = sha256(secretValue);
const mandateId = "fix-ci";
const toolName = "github_ci_secret_status";

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:github-ci-first-loop`."
  );
}

try {
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");

  const add = runCliJson(
    "add",
    "github-ci",
    "--command",
    process.execPath,
    "--arg",
    fixtureServerPath,
    "--arg",
    "secret",
    "--arg",
    "GITHUB_PERSONAL_ACCESS_TOKEN",
    "--arg",
    secretHash,
    "--write",
    "--json"
  );
  assert(add.action === "created", "expected add to create config");
  assert(add.mandateCommand?.includes("--profiles github_ci"), "expected mandate command");
  assertNoSecretText(JSON.stringify(add), "add output");

  const setSecret = runCli(
    ["secrets", "set", secretRef, "--value-stdin", "--json"],
    secretValue
  );
  assert(setSecret.status === 0, "expected secrets set to succeed");
  assertNoSecretLeak(setSecret, "secrets set");

  const checkResult = runCli([
    "presets",
    "check",
    "github-ci",
    "--profile",
    "github_ci",
    "--json"
  ]);
  assert(
    checkResult.status === 1,
    "expected provider check to flag fixture sensitive-looking tool"
  );
  assertNoSecretLeak(checkResult, "provider check");
  const check = JSON.parse(checkResult.stdout);
  assert(
    check.schemaVersion === "switchboard.provider-preset-check.v1",
    "expected provider check schema"
  );
  assert(
    check.tools?.some?.((tool) => tool.toolName === toolName),
    "expected fixture GitHub CI tool in provider check"
  );
  assert(
    check.counts?.allowedSensitive === 1,
    "expected one allowed-sensitive fixture tool"
  );
  assertNoSecretText(JSON.stringify(check), "provider check");

  const create = runCliJson(
    "mandate",
    "create",
    mandateId,
    "--agent",
    "implementer",
    "--profiles",
    "github_ci",
    "--branch",
    "fix/ci",
    "--lease",
    "2h",
    "--allow-tool",
    "github_ci_*",
    "--deny-tool",
    "github_ci_deploy_prod",
    "--deny-tool",
    "github_ci_delete_*",
    "--deny-tool",
    "github_ci_admin_*",
    "--require-approval-tool",
    "github_ci_*rerun*",
    "--require-approval-reason",
    "rerunning CI changes remote provider state",
    "--require-approval-risk",
    "medium",
    "--require-approval-label",
    "github",
    "--require-approval-label",
    "write",
    "--json"
  );
  assert(create.mandate?.id === mandateId, "expected mandate id");
  assertNoSecretText(JSON.stringify(create), "mandate create");

  const tools = runCliJson("tools", "--mandate", mandateId, "--json");
  assert(
    tools.tools?.some?.((tool) => tool.name === toolName),
    "expected scoped tool surface"
  );
  assertNoSecretText(JSON.stringify(tools), "tool surface");

  await assertMandateServeSeesSecret();

  const logs = runCliJson("logs", "--mandate", mandateId, "--json");
  assert(
    logs.entries?.some?.(
      (entry) =>
        entry.mandateId === mandateId &&
        entry.status === "ok" &&
        entry.toolName === toolName
    ),
    "expected mandate-linked audit entry"
  );
  assertNoSecretText(JSON.stringify(logs), "logs");
  assertNoSecretText(readAuditLog(), "raw audit log");

  const report = runCliJson("mandate", "report", mandateId, "--json");
  assert(
    report.readiness?.selectedCanHandoff === true,
    "expected mandate report ready"
  );
  assertNoSecretText(JSON.stringify(report), "report");
} finally {
  rmSync(project, { force: true, recursive: true });
}

function runCli(args, input) {
  return spawnSync(process.execPath, [cliPath, "--cwd", project, ...args], {
    cwd: repo,
    encoding: "utf8",
    input,
    env: smokeEnv()
  });
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

async function assertMandateServeSeesSecret() {
  const client = new Client({
    name: "switchboard-github-ci-first-loop-smoke",
    version: "0.1.0"
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "--cwd", project, "serve", "--mandate", mandateId],
    cwd: repo,
    env: smokeEnv(),
    stderr: "pipe"
  });

  let serveStderr = "";
  transport.stderr?.on("data", (chunk) => {
    serveStderr += chunk.toString();
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert(
      tools.tools.some((tool) => tool.name === toolName),
      "expected GitHub CI fixture tool in serve list"
    );
    const result = await client.callTool({ name: toolName, arguments: {} });
    assert(textContent(result) === "secret:match", "expected injected secret");
    assertNoSecretText(JSON.stringify(result), "tool result");
  } finally {
    await client.close();
  }

  assertNoSecretText(serveStderr, "serve stderr");
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

function readAuditLog() {
  return readFileSync(
    join(project, "xdg-state", "switchboard", "logs", "switchboard.jsonl"),
    "utf8"
  );
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

function textContent(result) {
  if (!Array.isArray(result.content)) {
    return "";
  }
  const first = result.content[0];
  return first?.type === "text" && typeof first.text === "string"
    ? first.text
    : "";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
