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
const allowedReadTool = `${profileName}_get_pull_request`;
const allowedCheckTool = `${profileName}_list_workflow_runs`;
const allowedLogTool = `${profileName}_get_job_logs`;
const approvalRerunTool = `${profileName}_rerun_workflow`;
const approvalWriteTool = `${profileName}_issue_write`;
const deniedDeleteTool = `${profileName}_delete_file`;
const deniedAdminTool = `${profileName}_create_repository`;
const fixtureCliPath = join(project, "fixture");
const fixtureCallLogPath = join(project, "fixture-tool-calls.log");
const runtimeDir = join(project, "runtime");
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
    profileName,
    "--arg",
    "GITHUB_PERSONAL_ACCESS_TOKEN",
    "--arg",
    secretHash,
    "--arg",
    "get_pull_request",
    "--arg",
    "list_workflow_runs",
    "--arg",
    "get_job_logs",
    "--arg",
    "rerun_workflow",
    "--arg",
    "issue_write",
    "--arg",
    "delete_file",
    "--arg",
    "create_repository",
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
  assertToolClass(check, allowedReadTool, "allowed");
  assertToolClass(check, allowedCheckTool, "allowed");
  assertToolClass(check, allowedLogTool, "allowed");
  assertToolClass(check, approvalRerunTool, "approval_required");
  assertToolClass(check, approvalWriteTool, "approval_required");
  assertToolClass(check, deniedDeleteTool, "denied");
  assertToolClass(check, deniedAdminTool, "denied");
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
  assert(
    tools.tools?.some?.((tool) => tool.name === allowedReadTool),
    "expected allowed GitHub read tool in scoped surface"
  );
  assert(
    tools.tools?.some?.(
      (tool) =>
        tool.name === approvalRerunTool &&
        tool._meta?.switchboard?.approvalRequired?.risk === "medium"
    ),
    "expected approval-gated GitHub rerun tool metadata"
  );
  assert(
    !tools.tools?.some?.((tool) => tool.name === deniedDeleteTool),
    "expected denied delete tool hidden from scoped surface"
  );
  assertNoSecretText(JSON.stringify(tools), "tool surface");

  await assertMandateServeSeesSecret();
  await assertGithubAuthorityPack();
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
  assert(
    logs.entries?.some?.(
      (entry) =>
        entry.mandateId === mandateId &&
        entry.status === "ok" &&
        entry.toolName === allowedReadTool
    ),
    "expected allowed GitHub read audit entry"
  );
  const approvalRequiredAudit = logs.entries?.find?.(
    (entry) =>
      entry.mandateId === mandateId &&
      entry.status === "error" &&
      entry.toolName === approvalWriteTool &&
      entry.approvalRequestId
  );
  assert(approvalRequiredAudit, "expected approval-required GitHub write audit entry");
  assert(
    logs.entries?.some?.(
      (entry) =>
        entry.mandateId === mandateId &&
        entry.status === "ok" &&
        entry.toolName === approvalRerunTool &&
        entry.approvalRequestId
    ),
    "expected approved GitHub rerun audit entry"
  );
  assert(
    logs.entries?.some?.(
      (entry) =>
        entry.mandateId === mandateId &&
        entry.status === "error" &&
        entry.toolName === deniedDeleteTool &&
        entry.error?.includes?.("denied")
    ),
    "expected denied GitHub delete audit entry"
  );
  assertNoSecretText(JSON.stringify(logs), "logs");
  assertNoSecretText(readAuditLog(), "raw audit log");

  const report = runCliJson("mandate", "report", mandateId, "--json");
  assert(
    report.readiness?.selectedCanHandoff === true,
    "expected mandate report ready"
  );
  assert(
    report.counts?.approvalRequests === 2,
    "expected denied and approved approval requests in report"
  );
  assert(
    report.approvalRequests?.some?.(
      (request) =>
        request.toolName === approvalWriteTool &&
        request.runtimeStatus === "denied"
    ),
    "expected denied GitHub write approval request in report"
  );
  assert(
    report.approvalRequests?.some?.(
      (request) =>
        request.toolName === approvalRerunTool &&
        request.runtimeStatus === "approved"
    ),
    "expected approved GitHub rerun approval request in report"
  );
  assert(
    report.auditEntries?.some?.((entry) => entry.toolName === deniedDeleteTool),
    "expected denied GitHub audit entry in report"
  );
  assertNoSecretText(JSON.stringify(report), "report");
} finally {
  runCli(["daemon", "stop", "--json"], undefined, { allowFailure: true });
  rmSync(project, { force: true, recursive: true });
}

function runCli(args, input, options = {}) {
  const result = spawnSync(process.execPath, [cliPath, "--cwd", project, ...args], {
    cwd: repo,
    encoding: "utf8",
    input,
    env: smokeEnv()
  });
  if (result.status !== 0 && !options.allowFailure) {
    return result;
  }
  return result;
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

async function assertGithubAuthorityPack() {
  const client = new Client({
    name: "switchboard-github-ci-authority-pack-smoke",
    version: "0.1.0"
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "--cwd", project, "mcp", "--mandate", mandateId],
    cwd: repo,
    env: smokeEnv(),
    stderr: "pipe"
  });

  let mcpStderr = "";
  transport.stderr?.on("data", (chunk) => {
    mcpStderr += chunk.toString();
  });

  try {
    try {
      await client.connect(transport);

      const tools = await client.listTools();
      assert(
        tools.tools.some((tool) => tool.name === allowedReadTool),
        "expected allowed GitHub read tool in MCP list"
      );
      const gatedTool = tools.tools.find(
        (tool) => tool.name === approvalRerunTool
      );
      assert(gatedTool, "expected approval-gated GitHub rerun tool in MCP list");
      assert(
        gatedTool._meta?.switchboard?.approvalRequired?.reason ===
          "rerunning CI changes remote provider state",
        "expected rerun approval reason"
      );
      assert(
        !tools.tools.some((tool) => tool.name === deniedAdminTool),
        "expected denied repository creation tool hidden from MCP list"
      );

      const readResult = await client.callTool({
        name: allowedReadTool,
        arguments: { message: "inspect" }
      });
      assert(
        textContent(readResult) === `${profileName}:get_pull_request:inspect`,
        "expected allowed GitHub read call to route upstream"
      );
      assertToolCallCount("get_pull_request", 1);

      const writeBlock = await captureResult(() =>
        client.callTool({
          name: approvalWriteTool,
          arguments: { message: "comment" }
        })
      );
      assert(
        writeBlock.error || writeBlock.result?.isError === true,
        "expected GitHub write call to require approval before upstream execution"
      );
      assertToolCallCount("issue_write", 0);
      const writeApprovals = runCliJson(
        "approvals",
        "--mandate",
        mandateId,
        "--json"
      );
      const writeRequest = writeApprovals.requests?.find?.(
        (request) =>
          request.toolName === approvalWriteTool &&
          request.runtimeStatus === "pending"
      );
      assert(writeRequest, "expected pending approval request for GitHub write");
      assert(
        writeRequest.approvalGateReason ===
          "write tools change GitHub repository, issue, or pull request state",
        "expected GitHub write approval reason"
      );
      const denied = runCliJson(
        "deny",
        writeRequest.id,
        "--reason",
        "do not write comments during fixture proof",
        "--json"
      );
      assert(
        denied.request?.runtimeStatus === "denied",
        "expected denied GitHub write approval request"
      );
      assertToolCallCount("issue_write", 0);

      const rerunBlock = await captureResult(() =>
        client.callTool({
          name: approvalRerunTool,
          arguments: { message: "rerun" }
        })
      );
      assert(
        rerunBlock.error || rerunBlock.result?.isError === true,
        "expected GitHub rerun call to require approval before upstream execution"
      );
      assertToolCallCount("rerun_workflow", 0);
      const rerunApprovals = runCliJson(
        "approvals",
        "--mandate",
        mandateId,
        "--json"
      );
      const rerunRequest = rerunApprovals.requests?.find?.(
        (request) =>
          request.toolName === approvalRerunTool &&
          request.runtimeStatus === "pending"
      );
      assert(rerunRequest, "expected pending approval request for GitHub rerun");
      const approved = runCliJson(
        "approve",
        rerunRequest.id,
        "--reason",
        "CI rerun approved for fixture proof",
        "--json"
      );
      assert(
        approved.request?.runtimeStatus === "approved",
        "expected approved GitHub rerun approval request"
      );
      const approvedRerun = await client.callTool({
        name: approvalRerunTool,
        arguments: { message: "rerun" }
      });
      assert(
        textContent(approvedRerun) === `${profileName}:rerun_workflow:rerun`,
        "expected approved GitHub rerun call to route upstream"
      );
      assertToolCallCount("rerun_workflow", 1);

      const deniedCall = await captureResult(() =>
        client.callTool({
          name: deniedDeleteTool,
          arguments: { message: "delete" }
        })
      );
      assert(
        deniedCall.error || deniedCall.result?.isError === true,
        "expected denied GitHub delete call to stay blocked"
      );
      assertToolCallCount("delete_file", 0);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nMCP stderr:\n${redactSecret(mcpStderr)}`
      );
    }
  } finally {
    await client.close().catch(() => {});
  }

  assertNoSecretText(mcpStderr, "mcp stderr");
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

async function captureResult(run) {
  try {
    return { result: await run() };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
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
      `        SWITCHBOARD_FIXTURE_CALL_LOG: ${JSON.stringify(fixtureCallLogPath)}`,
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
    SWITCHBOARD_RUNTIME_DIR: runtimeDir,
    TS_KEYRING_BACKEND: "file",
    SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS: "1",
    SWITCHBOARD_FIXTURE_CALL_LOG: fixtureCallLogPath
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

function assertToolCallCount(toolName, expected) {
  const calls = existsSync(fixtureCallLogPath)
    ? readFileSync(fixtureCallLogPath, "utf8")
        .split("\n")
        .filter(Boolean)
    : [];
  const actual = calls.filter((call) => call === toolName).length;
  assert(
    actual === expected,
    `expected ${toolName} upstream call count ${expected}, got ${actual}`
  );
}

function assertToolClass(check, toolName, classification) {
  const tool = check.tools?.find?.((entry) => entry.toolName === toolName);
  assert(tool, `expected provider check tool ${toolName}`);
  assert(
    tool.classification === classification,
    `expected ${toolName} to be ${classification}, got ${tool.classification}`
  );
}
