#!/usr/bin/env node
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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
const repoSlug = safeIdentifier(basename(project));
const profileName = `github_${repoSlug}_ci`;
const secretRef = `github/${repoSlug}/dev/token`;
const secretValue = "github-ci-loop-secret-do-not-print";
const secretHash = sha256(secretValue);
const mandateId = "fix-ci";
const toolName = `${profileName}_secret_status`;
const fixtureCliPath = join(project, "fixture");
const unmountedSecretRef = `github/${repoSlug}/dev/unmounted-token`;
const unmountedSecretValue = "github-ci-unmounted-secret-do-not-print";

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:github-ci-first-loop`."
  );
}

try {
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");
  writeFixtureCli();

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
  assert(add.mandateCommand?.includes(`--profiles ${profileName}`), "expected mandate command");
  assertNoSecretText(JSON.stringify(add), "add output");
  appendRunModeEnvGuards();

  const setSecret = runCli(
    ["secrets", "set", secretRef, "--value-stdin", "--json"],
    secretValue
  );
  assert(setSecret.status === 0, "expected secrets set to succeed");
  assertNoSecretLeak(setSecret, "secrets set");
  const setUnmountedSecret = runCli(
    ["secrets", "set", unmountedSecretRef, "--value-stdin", "--json"],
    unmountedSecretValue
  );
  assert(setUnmountedSecret.status === 0, "expected unmounted secret set to succeed");
  assertNoSecretLeak(setUnmountedSecret, "unmounted secrets set");

  const checkResult = runCli([
    "presets",
    "check",
    "github-ci",
    "--profile",
    profileName,
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
    "--from",
    "github-ci",
    "--profiles",
    profileName,
    "--json"
  );
  assert(create.mandate?.id === mandateId, "expected mandate id");
  assert(create.mandate?.branch === "fix/ci", "expected template branch");
  assert(
    create.mandate?.deniedTools?.includes?.(`${profileName}_deploy_prod`),
    "expected template denied production deploy"
  );
  assert(
    create.mandate?.deniedTools?.includes?.(`${profileName}_create_repository`),
    "expected template denied repository creation"
  );
  assert(
    create.mandate?.approvalGates?.some?.(
      (gate) => gate.toolPattern === `${profileName}_*comment*`
    ),
    "expected comment approval gate from template"
  );
  assert(
    create.mandate?.approvalGates?.some?.(
      (gate) => gate.toolPattern === `${profileName}_*merge*`
    ),
    "expected merge approval gate from template"
  );
  assert(
    create.mcpLaunch?.schemaVersion === "switchboard.mcp-launch.v1",
    "expected mcp launch payload"
  );
  assertNoSecretText(JSON.stringify(create), "mandate create");

  const tools = runCliJson("tools", "--mandate", mandateId, "--json");
  assert(
    tools.tools?.some?.((tool) => tool.name === toolName),
    "expected scoped tool surface"
  );
  assertNoSecretText(JSON.stringify(tools), "tool surface");

  await assertMandateServeSeesSecret();
  assertMandateRunSeesSecret();

  const logs = runCliJson("logs", "--mandate", mandateId, "--json");
  const toolAudit = logs.entries?.find?.(
    (entry) =>
      entry.mandateId === mandateId &&
      entry.status === "ok" &&
      entry.toolName === toolName
  );
  assert(toolAudit, "expected mandate-linked audit entry");
  const runAudit = logs.entries?.find?.(
    (entry) =>
      entry.mandateId === mandateId &&
      entry.action === "command_run" &&
      entry.status === "ok" &&
      entry.command === fixtureCliPath
  );
  assert(runAudit, "expected mandate-linked run-mode audit entry");
  assert(JSON.stringify(runAudit.args) === JSON.stringify(["checks"]), "expected audited run args");
  assert(runAudit.cwd === project, "expected audited run cwd");
  assert(runAudit.exitCode === 0, "expected audited run exit code");
  assert(typeof runAudit.durationMs === "number", "expected audited run duration");
  assert(
    JSON.stringify(runAudit.envKeys) === JSON.stringify(["GITHUB_PERSONAL_ACCESS_TOKEN"]),
    "expected exact audited run env keys"
  );
  assert(runAudit.stdoutSnippet?.includes?.("hasGithubToken"), "expected stdout audit snippet");
  assert(!runAudit.stderrSnippet, "expected no stderr audit snippet");
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

function assertMandateRunSeesSecret() {
  const result = runCliJson(
    "run",
    "--mandate",
    mandateId,
    "--json",
    fixtureCliPath,
    "checks"
  );
  assert(result.ok === true, "expected run mode to succeed");
  assert(
    JSON.stringify(result.envKeys) === JSON.stringify(["GITHUB_PERSONAL_ACCESS_TOKEN"]),
    "expected exact scoped GitHub token env key"
  );
  const child = JSON.parse(result.stdout);
  assert(child.hasGithubToken === true, "expected run mode to inject GitHub token");
  assert(child.rawSecret === null, "expected raw unscoped env to stay absent");
  assert(child.literalEnv === null, "expected literal profile env to stay absent");
  assert(child.unmountedGithubToken === null, "expected unmounted profile secret to stay absent");
  assert(child.argv?.[0] === "checks", "expected fixture CLI argument");
  assertNoSecretText(JSON.stringify(result), "run mode result");
  assertNoSecretText(JSON.stringify(result), "run mode result unmounted secret", unmountedSecretValue);
}

function writeFixtureCli() {
  writeFileSync(
    fixtureCliPath,
    [
      "#!/bin/sh",
      "has=false",
      "[ -n \"$GITHUB_PERSONAL_ACCESS_TOKEN\" ] && has=true",
      "raw=null",
      "[ -n \"$RAW_SECRET\" ] && raw='\"present\"'",
      "literal=null",
      "[ -n \"$GITHUB_LITERAL_ENV\" ] && literal='\"present\"'",
      "unmounted=null",
      "[ -n \"$UNMOUNTED_GITHUB_TOKEN\" ] && unmounted='\"present\"'",
      "printf '{\"argv\":[\"%s\"],\"hasGithubToken\":%s,\"rawSecret\":%s,\"literalEnv\":%s,\"unmountedGithubToken\":%s}\\n' \"$1\" \"$has\" \"$raw\" \"$literal\" \"$unmounted\""
    ].join("\n")
  );
  chmodSync(fixtureCliPath, 0o755);
}

function appendRunModeEnvGuards() {
  const configPath = join(project, ".switchboard.yaml");
  const existing = readFileSync(configPath, "utf8");
  const withLiteral = existing.replace(
    `        GITHUB_PERSONAL_ACCESS_TOKEN:\n          secretRef: ${secretRef}`,
    [
      `        GITHUB_PERSONAL_ACCESS_TOKEN:`,
      `          secretRef: ${secretRef}`,
      `        GITHUB_LITERAL_ENV: literal_should_not_be_injected`
    ].join("\n")
  );
  const unmountedProfile = [
    `  github_${repoSlug}_unmounted:`,
    `    provider: github`,
    `    namespace: github_${repoSlug}_unmounted`,
    `    upstream:`,
    `      type: stdio`,
    `      command: fixture-unmounted`,
    `      env:`,
    `        UNMOUNTED_GITHUB_TOKEN:`,
    `          secretRef: ${unmountedSecretRef}`,
    ""
  ].join("\n");
  writeFileSync(
    configPath,
    withLiteral.replace("workspaces:\n", `${unmountedProfile}workspaces:\n`)
  );
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
  assertNoSecretText(result.stdout, `${label} stdout unmounted`, unmountedSecretValue);
  assertNoSecretText(result.stderr, `${label} stderr unmounted`, unmountedSecretValue);
}

function assertNoSecretText(value, label, secret = secretValue) {
  assert(!value.includes(secret), `${label} printed secret value`);
}

function redactSecret(value) {
  return value
    .replaceAll(secretValue, "[redacted]")
    .replaceAll(unmountedSecretValue, "[redacted]");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeIdentifier(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "repo";
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
