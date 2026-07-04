#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const repoRoot = resolve(packageDir, "..", "..");
const cliPath = resolve(repoRoot, "apps", "cli", "dist", "index.js");
const fixtureServerPath = resolve(packageDir, "fixtures", "echo-server.mjs");
const tmpRoot = join(
  "/tmp",
  `switchboard-mandate-walkthrough-${Date.now()}-${Math.random().toString(16).slice(2)}`
);
const runtimeDir = join(tmpRoot, "runtime");
const quotedTmpRoot = shellQuote(tmpRoot);

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:mandate-walkthrough`."
  );
}

try {
  mkdirSync(tmpRoot, { recursive: true });
  writeFileSync(join(tmpRoot, ".gitignore"), ".switchboard.local.yaml\n");
  writeFileSync(
    join(tmpRoot, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  demo_echo:",
      "    provider: generic",
      "    namespace: demo_echo",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - demo"
    ].join("\n")
  );

  const createText = runCliText(
    "mandate",
    "create",
    "fix-ci",
    "--agent",
    "implementer",
    "--profiles",
    "demo_echo",
    "--branch",
    "fix/ci",
    "--lease",
    "2h",
    "--allow-tool",
    "demo_echo_*",
    "--require-approval-tool",
    "demo_echo_echo",
    "--require-approval-reason",
    "rerunning CI changes remote state",
    "--require-approval-risk",
    "high",
    "--require-approval-label",
    "ci"
  );
  assert(createText.includes("Created pass fix-ci"), "expected create text");
  assert(createText.includes("Next commands:"), "expected create next commands");
  assertHumanNextCommands(createText, { includeTools: true });

  const toolsText = runCliText("tools", "--mandate", "fix-ci");
  assert(toolsText.includes("Switchboard tools"), "expected human tools output");
  assert(toolsText.includes("Pass: fix-ci (active)"), "expected mandate line");
  assert(
    toolsText.includes("demo_echo_echo (demo_echo) approval-required"),
    "expected approval-required human tool annotation"
  );
  assertHumanNextCommands(toolsText);

  const toolsJson = runCliJson("tools", "--mandate", "fix-ci", "--json");
  assert(
    toolsJson.schemaVersion === "switchboard.tool-surface.v1",
    "expected tool surface schema"
  );
  const gatedTool = toolsJson.tools?.find(
    (tool) => tool.name === "demo_echo_echo"
  );
  assert(gatedTool, "expected gated echo tool in JSON preflight");
  assert(
    gatedTool._meta?.switchboard?.approvalRequired?.reason ===
      "rerunning CI changes remote state",
    "expected approval reason in JSON preflight"
  );

  const daemonStart = runDaemon("start");
  assert(
    daemonStart.status?.state === "running" || daemonStart.state === "running",
    "expected daemon to start"
  );

  const client = new Client({
    name: "switchboard-mandate-walkthrough",
    version: "0.1.0"
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      cliPath,
      "--cwd",
      tmpRoot,
      "mcp",
      "--runtime-dir",
      runtimeDir,
      "--mandate",
      "fix-ci"
    ],
    cwd: repoRoot,
    env: smokeEnv(),
    stderr: "pipe"
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    try {
      await client.connect(transport);

      const listedTools = await client.listTools();
      const listedGatedTool = listedTools.tools.find(
        (tool) => tool.name === "demo_echo_echo"
      );
      assert(listedGatedTool, "expected MCP tools/list to include gated tool");
      assert(
        listedGatedTool._meta?.switchboard?.approvalRequired?.risk === "high",
        "expected MCP tools/list approval metadata"
      );

      const firstCall = await captureResult(() =>
        client.callTool({
          name: "demo_echo_echo",
          arguments: { message: "rerun" }
        })
      );
      assert(
        firstCall.error || firstCall.result?.isError === true,
        "expected gated call to be blocked before approval"
      );

      const approvals = runCliJson("approvals", "--mandate", "fix-ci", "--json");
      const pendingRequest = approvals.requests?.find(
        (request) => request.runtimeStatus === "pending"
      );
      assert(pendingRequest, "expected pending approval request");
      assert(
        pendingRequest.approvalGateReason === "rerunning CI changes remote state",
        "expected approval request reason"
      );

      const approvalsText = runCliText("approvals", "--mandate", "fix-ci");
      assert(
        approvalsText.includes("Summary: 1 pending"),
        "expected approval summary"
      );
      assert(
        approvalsText.includes(`${pendingRequest.id} [pending]`),
        "expected readable pending request"
      );
      assert(
        approvalsText.includes(
          `switchboard approve ${pendingRequest.id} --reason "<why this is safe>"`
        ),
        "expected approve next command"
      );
      assert(
        approvalsText.includes(
          `switchboard deny ${pendingRequest.id} --reason "<why this should not run>"`
        ),
        "expected deny next command"
      );
      assert(
        approvalsText.includes(
          "retry the original demo_echo_echo tool call after approval"
        ),
        "expected retry guidance"
      );
      const approvalsWatchText = runCliText(
        "approvals",
        "--mandate",
        "fix-ci",
        "--watch",
        "--timeout",
        "0"
      );
      assert(
        approvalsWatchText.includes("Approval requests snapshot"),
        "expected approval watch heading"
      );
      assert(
        approvalsWatchText.includes(`${pendingRequest.id} [pending]`),
        "expected approval watch pending request"
      );
      const approvalsWatchJson = runCliJson(
        "approvals",
        "--mandate",
        "fix-ci",
        "--watch",
        "--timeout",
        "0",
        "--json"
      );
      assert(
        approvalsWatchJson.schemaVersion === "switchboard.approvals-watch.v1",
        "expected approval watch schema"
      );
      assert(
        approvalsWatchJson.watch?.snapshots === 1,
        "expected one bounded approval watch snapshot"
      );
      assert(
        approvalsWatchJson.snapshots?.[0]?.approvals?.counts?.pending === 1,
        "expected pending approval in watch snapshot"
      );

      const approved = runCliJson(
        "approve",
        pendingRequest.id,
        "--reason",
        "CI rerun is expected",
        "--json"
      );
      assert(
        approved.request?.runtimeStatus === "approved",
        "expected approved request"
      );

      const approvedCall = await client.callTool({
        name: "demo_echo_echo",
        arguments: { message: "rerun" }
      });
      assert(
        textContent(approvedCall) === "demo:rerun",
        "expected approved MCP call result"
      );

      const logs = runCliJson("logs", "--mandate", "fix-ci", "--json");
      assert(
        logs.schemaVersion === "switchboard.audit-log.v1",
        "expected audit log schema"
      );
      assert(
        logs.entries?.some(
          (entry) =>
            entry.status === "error" &&
            entry.toolName === "demo_echo_echo" &&
            entry.approvalRequestId === pendingRequest.id
        ),
        "expected approval-required audit entry"
      );
      assert(
        logs.entries?.some(
          (entry) =>
            entry.status === "ok" &&
            entry.toolName === "demo_echo_echo" &&
            entry.approvalRequestId === pendingRequest.id
        ),
        "expected approved call audit entry"
      );
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nMCP stderr:\n${stderr}`
      );
    }
  } finally {
    await client.close();
  }

  const handoff = runCliJson(
    "mandate",
    "handoff",
    "fix-ci",
    "--state",
    "completed",
    "--summary",
    "CI is green",
    "--next-step",
    "merge PR",
    "--artifact",
    "https://github.com/wkoverfield/switchboard/pull/214",
    "--by",
    "implementer-agent",
    "--json"
  );
  assert(
    handoff.mandate?.runtimeStatus === "closed",
    "expected closed mandate after handoff"
  );

  const report = runCliJson("mandate", "report", "fix-ci", "--json");
  assert(
    report.schemaVersion === "switchboard.mandate-report.v1",
    "expected mandate report schema"
  );
  assert(report.selectedMandateId === "fix-ci", "expected selected mandate");
  assert(
    report.results?.counts?.completed === 1,
    "expected completed result"
  );
  assert(
    report.readiness?.selectedHandoffState === "completed" &&
      report.readiness?.openChildMandates?.length === 0 &&
      report.readiness?.pendingApprovalRequests?.length === 0,
    "expected no readiness blockers after handoff"
  );
} finally {
  runDaemon("stop", { allowFailure: true });
  rmSync(tmpRoot, { recursive: true, force: true });
}

function runCliJson(...args) {
  const output = runCliText(...args);
  return output ? JSON.parse(output) : {};
}

function runCliText(...args) {
  const result = spawnSync(process.execPath, [cliPath, "--cwd", tmpRoot, ...args], {
    encoding: "utf8",
    env: smokeEnv()
  });

  if (result.status !== 0) {
    throw new Error(
      `switchboard ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }

  return result.stdout.trim();
}

function runDaemon(command, options = {}) {
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "--cwd",
      tmpRoot,
      "daemon",
      command,
      "--runtime-dir",
      runtimeDir,
      "--json"
    ],
    {
      encoding: "utf8",
      env: smokeEnv()
    }
  );

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `daemon ${command} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }

  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function smokeEnv() {
  return {
    ...process.env,
    XDG_STATE_HOME: tmpRoot,
    SWITCHBOARD_RUNTIME_DIR: runtimeDir
  };
}

async function captureResult(run) {
  try {
    return { result: await run() };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertHumanNextCommands(output, options = {}) {
  const expectedCommands = [
    ...(options.includeTools
      ? [`switchboard --cwd ${quotedTmpRoot} tools --mandate fix-ci`]
      : []),
    `switchboard --cwd ${quotedTmpRoot} mcp --mandate fix-ci`,
    `switchboard --cwd ${quotedTmpRoot} approvals --mandate fix-ci --json`,
    `switchboard --cwd ${quotedTmpRoot} logs --mandate fix-ci --json`,
    `switchboard --cwd ${quotedTmpRoot} pass handoff fix-ci --state completed --summary <summary>`
  ];

  for (const command of expectedCommands) {
    assert(output.includes(command), `expected repo-aware suggestion: ${command}`);
  }
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function textContent(result) {
  if (!Array.isArray(result.content)) {
    return "";
  }

  const first = result.content[0];
  if (first?.type !== "text" || typeof first.text !== "string") {
    return "";
  }

  return first.text;
}
