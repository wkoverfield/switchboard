#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const scenario = process.argv[2];
const knownScenarios = new Set([
  "import",
  "package-import",
  "github-ci",
  "expired-mandate",
  "subagent"
]);
if (!knownScenarios.has(scenario)) {
  throw new Error(
    `usage: fresh-agent.mjs <${Array.from(knownScenarios).join("|")}>`
  );
}

const repo = resolve(import.meta.dirname, "..", "..");
const cliPath = join(repo, "apps/cli/dist/index.js");
const fixtureServerPath = join(
  repo,
  "packages/mcp-runtime/fixtures/echo-server.mjs"
);
const outputRoot = join(repo, ".switchboard-evals");
const secretValue = "fresh-agent-secret-do-not-print";
const secretHash = sha256(secretValue);

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before running fresh-agent evals."
  );
}

mkdirSync(outputRoot, { recursive: true });

const project = mkdtempSync(join(tmpdir(), `switchboard-eval-${scenario}-`));
const packDir = mkdtempSync(join(tmpdir(), `switchboard-eval-pack-${scenario}-`));
const stateHome = join(project, ".state");
const transcript = [];
const scores = [];

try {
  const result =
    scenario === "import"
      ? evalImport()
      : scenario === "package-import"
        ? evalPackageImport()
        : scenario === "github-ci"
          ? evalGithubCi()
          : scenario === "expired-mandate"
            ? evalExpiredMandate()
            : evalSubagent();

  const summary = {
    schemaVersion: "switchboard.fresh-agent-eval.v1",
    scenario,
    project,
    passed: scores.every((score) => score.passed),
    scores,
    result
  };
  writeSummary(summary);
  if (!summary.passed) {
    throw new Error(
      `fresh-agent eval ${scenario} failed: ${scores
        .filter((score) => !score.passed)
        .map((score) => score.name)
        .join(", ")}`
    );
  }
} finally {
  rmSync(packDir, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
}

function evalImport() {
  minimalPrompt(
    "You are in a repo with existing MCP configs. Use Switchboard to inspect cleanup, but do not write config or expose secrets."
  );
  initRepo("main");
  mkdirSync(join(project, ".codex"), { recursive: true });
  writeFileSync(
    join(project, ".codex", "config.toml"),
    [
      "[mcp_servers.github]",
      'command = "docker"',
      'args = ["run", "-i", "ghcr.io/github/github-mcp-server"]',
      "[mcp_servers.vercel]",
      'command = "npx"',
      'args = ["-y", "vercel-mcp"]'
    ].join("\n")
  );
  writeFileSync(
    join(project, ".mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          github: {
            command: "docker",
            args: ["run", "-i", "ghcr.io/github/github-mcp-server"],
            env: {
              GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_should_not_print"
            }
          }
        }
      },
      null,
      2
    )
  );

  const plan = runCliJson("import", "--dry-run", "--json");
  score("chose import dry-run", plan.schemaVersion === "switchboard.import-plan.v1");
  score("detected existing clients", JSON.stringify(plan).includes("codex"));
  score("kept raw secrets redacted", !JSON.stringify(plan).includes("ghp_should"));
  score("returned structured commands", Boolean(plan.commands || plan.actions));
  return { detectedActions: plan.actions?.length ?? 0 };
}

function evalPackageImport() {
  minimalPrompt(
    "You are in a fresh repo with messy Claude and Codex MCP configs. Use only the installed Switchboard package to inspect, clean up, and explain the safer next step."
  );
  initRepo("main");
  installLocalPackages();
  mkdirSync(join(project, ".codex"), { recursive: true });
  writeFileSync(
    join(project, ".codex", "config.toml"),
    [
      "[mcp_servers.github]",
      'command = "docker"',
      'args = ["run", "-e", "GITHUB_TOKEN=ghp_should_not_print", "ghcr.io/github/github-mcp-server"]',
      'env = { GITHUB_TOKEN = "ghp_should_not_print" }',
      "",
      "[mcp_servers.filesystem]",
      'command = "npx"',
      `args = ["-y", "@modelcontextprotocol/server-filesystem", "${project}/.."]`
    ].join("\n")
  );
  writeFileSync(
    join(project, ".mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          vercel: {
            command: "npx",
            args: ["-y", "vercel-mcp"],
            env: {
              VERCEL_TOKEN: "vercel_should_not_print"
            }
          }
        }
      },
      null,
      2
    )
  );

  const scan = runPackageCliJson("scan", "--json");
  const dryRun = runPackageCliJson("import", "--dry-run", "--json");
  const write = runPackageCliJson("import", "--write", "--cleanup-client", "--json");
  const doctor = runPackageCliJsonAllowFailure("doctor", "--json");

  score("package scan found bypasses", scan.authorityStatus?.status === "bypass-present");
  score(
    "package import recommended cleanup first",
    dryRun.recommendedNextAction?.primary?.command ===
      "switchboard import --write --cleanup-client"
  );
  score("package cleanup wrote backup", write.clientCleanup?.some?.((item) => item.backupPath));
  score(
    "package doctor gives credential next step",
    JSON.stringify(doctor).includes("switchboard secrets set")
  );
  score("package eval avoided raw secrets", !/ghp_should|vercel_should/.test(transcriptText()));
  score(
    "package eval explains authority",
    JSON.stringify(dryRun).includes("authorityStatus") &&
      JSON.stringify(write).includes("clientCleanup")
  );
  return {
    scanStatus: scan.authorityStatus?.status,
    dryRunPrimary: dryRun.recommendedNextAction?.primary?.command,
    cleanupItems: write.clientCleanup?.length ?? 0,
    doctorStatus: doctor.status
  };
}

function evalGithubCi() {
  minimalPrompt(
    "You are in a clean repo. Prepare GitHub CI access through Switchboard, create a scoped mandate, and inspect the tool surface."
  );
  initRepo("main");
  const repoSlug = safeIdentifier(basename(project));
  const profileName = `github_${repoSlug}_ci`;
  const secretRef = `github/${repoSlug}/dev/token`;

  const add = runCliJson(
    "add",
    "github-ci",
    "--profile-name",
    profileName,
    "--secret-ref",
    secretRef,
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
    "rerun_workflow",
    "--arg",
    "delete_file",
    "--write",
    "--json"
  );
  const namespace = add.namespace ?? profileName;
  const allowedReadTool = `${namespace}_get_pull_request`;
  const approvalRerunTool = `${namespace}_rerun_workflow`;
  const deniedDeleteTool = `${namespace}_delete_file`;
  score("used Switchboard setup", add.schemaVersion === "switchboard.provider-add.v1");
  runCliJsonWithInput(
    secretValue,
    "secrets",
    "set",
    secretRef,
    "--value-stdin",
    "--json"
  );
  const mandate = runCliJson(
    "mandate",
    "create",
    "--from",
    "github-ci",
    "--profiles",
    profileName,
    "--json"
  );
  const check = runCliJsonAllowFailure(
    "presets",
    "check",
    "github-ci",
    "--profile",
    profileName,
    "--json"
  );
  const tools = runCliJson("tools", "--mandate", "fix-ci", "--json");
  score("created scoped mandate", mandate.mandate?.id === "fix-ci");
  score("received mcp launch", Boolean(mandate.mcpLaunch?.args));
  score(
    "used Switchboard tool surface",
    tools.tools?.some?.(
      (tool) =>
        tool.profileName === profileName &&
        tool.upstreamName === "echo" &&
        tool.name?.endsWith?.("_echo")
    )
  );
  score(
    "classified GitHub reads as allowed",
    check.tools?.some?.(
      (tool) =>
        tool.toolName === allowedReadTool && tool.classification === "allowed"
    )
  );
  score(
    "classified GitHub reruns as approval-gated",
    check.tools?.some?.(
      (tool) =>
        tool.toolName === approvalRerunTool &&
        tool.classification === "approval_required"
    )
  );
  score(
    "classified GitHub delete as denied",
    check.tools?.some?.(
      (tool) =>
        tool.toolName === deniedDeleteTool && tool.classification === "denied"
    )
  );
  score(
    "hid denied GitHub tools from mandate surface",
    !tools.tools?.some?.((tool) => tool.name === deniedDeleteTool)
  );
  score("avoided raw secrets", transcriptText().includes(secretValue) === false);
  return { mandateId: mandate.mandate?.id, toolCount: tools.tools?.length ?? 0 };
}

function evalExpiredMandate() {
  minimalPrompt(
    "You are handed an expired mandate. Recover without bypassing Switchboard."
  );
  initRepo("main");
  writeBasicConfig();
  const created = runCliJson(
    "mandate",
    "create",
    "fix-ci",
    "--agent",
    "worker",
    "--profiles",
    "github_eval_ci",
    "--branch",
    "main",
    "--lease",
    "1m",
    "--json"
  );
  expireFirstMandate();
  const status = runCliJson("mandate", "status", "fix-ci", "--json");
  const nextActions = status.readiness?.nextActions ?? [];
  score(
    "noticed expired mandate",
    status.readiness?.blockers?.includes?.('mandate "fix-ci" is expired')
  );
  score(
    "followed renew action",
    nextActions.includes("switchboard mandate renew fix-ci --lease 1m")
  );
  const renewed = runCliJson(
    "mandate",
    "renew",
    "fix-ci",
    "--lease",
    "2h",
    "--json"
  );
  score("renewed mandate", renewed.mandate?.runtimeStatus === "active");
  return { created: created.mandate?.id, renewed: renewed.mandate?.runtimeStatus };
}

function evalSubagent() {
  minimalPrompt(
    "You are a harness. Request parent authority, delegate a narrower child mandate, and produce a report."
  );
  initRepo("main");
  const repoSlug = safeIdentifier(basename(project));
  const profileName = `github_${repoSlug}_ci`;
  const secretRef = `github/${repoSlug}/dev/token`;
  runCliJson(
    "add",
    "github-ci",
    "--profile-name",
    profileName,
    "--secret-ref",
    secretRef,
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
    "--write",
    "--json"
  );
  runCliJsonWithInput(
    secretValue,
    "secrets",
    "set",
    secretRef,
    "--value-stdin",
    "--json"
  );
  const parent = runCliJson(
    "mandate",
    "create",
    "--from",
    "github-ci",
    "--profiles",
    profileName,
    "--json"
  );
  const child = runCliJson(
    "mandate",
    "child",
    "inspect-ci",
    "--parent",
    "fix-ci",
    "--agent",
    "tester",
    "--profiles",
    profileName,
    "--branch",
    "main",
    "--lease",
    "30m",
    "--allow-tool",
    `${profileName}_echo`,
    "--json"
  );
  const report = runCliJson("mandate", "report", "fix-ci", "--json");
  score("created parent authority", parent.workspaceLease?.mandateId === "fix-ci");
  score("created child authority", child.mandate?.parentMandateId === "fix-ci");
  score(
    "reported delegation chain",
    report.childrenByParent?.["fix-ci"]?.includes?.("inspect-ci")
  );
  score("did not bypass Switchboard", transcriptText().includes("switchboard"));
  return { parent: parent.mandate?.id, child: child.mandate?.id };
}

function minimalPrompt(prompt) {
  transcript.push({ role: "user", content: prompt });
}

function initRepo(branch) {
  run("git", ["init", "-b", branch], { cwd: project });
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");
}

function writeBasicConfig() {
  writeFileSync(
    join(project, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_eval_ci:",
      "    provider: generic"
    ].join("\n")
  );
}

function expireFirstMandate() {
  const storePath = join(stateHome, "switchboard", "mandates", "mandates.json");
  const store = JSON.parse(readFileSync(storePath, "utf8"));
  store.mandates[0].createdAt = "2026-01-01T00:00:00.000Z";
  store.mandates[0].expiresAt = "2026-01-01T00:01:00.000Z";
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

function runCliJson(...args) {
  return JSON.parse(runCli(args).stdout);
}

function runCliJsonAllowFailure(...args) {
  return JSON.parse(runCli(args, { allowFailure: true }).stdout);
}

function runCliJsonWithInput(input, ...args) {
  return JSON.parse(runCli(args, { input }).stdout);
}

function runPackageCliJson(...args) {
  return JSON.parse(runPackageCli(args).stdout);
}

function runPackageCliJsonAllowFailure(...args) {
  return JSON.parse(runPackageCli(args, { allowFailure: true }).stdout);
}

function runCli(args, options = {}) {
  transcript.push({ role: "agent", command: ["switchboard", ...args].join(" ") });
  const result = run(process.execPath, [cliPath, "--cwd", project, ...args], {
    cwd: project,
    env: { ...process.env, XDG_STATE_HOME: stateHome },
    input: options.input,
    allowFailure: options.allowFailure
  });
  transcript.push({
    role: "tool",
    exitCode: result.status,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr)
  });
  return result;
}

function runPackageCli(args, options = {}) {
  const binary = join(project, "node_modules", ".bin", "switchboard");
  transcript.push({
    role: "agent",
    command: ["node_modules/.bin/switchboard", ...args].join(" ")
  });
  const result = run(binary, ["--cwd", project, ...args], {
    cwd: project,
    env: { ...process.env, XDG_STATE_HOME: stateHome },
    input: options.input,
    allowFailure: options.allowFailure
  });
  transcript.push({
    role: "tool",
    exitCode: result.status,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr)
  });
  return result;
}

function installLocalPackages() {
  const packageSpecs = [
    ["@switchboard-mcp/core", "packages/core"],
    ["@switchboard-mcp/mcp-runtime", "packages/mcp-runtime"],
    ["@switchboard-mcp/cli", "apps/cli"]
  ];
  for (const [filter] of packageSpecs) {
    run("pnpm", ["--filter", filter, "pack", "--pack-destination", packDir], {
      cwd: repo
    });
  }
  const dependencies = Object.fromEntries(
    packageSpecs.map(([name, path]) => {
      const version = JSON.parse(
        readFileSync(join(repo, path, "package.json"), "utf8")
      ).version;
      const tarball = `${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
      return [name, `file:${join(packDir, tarball)}`];
    })
  );
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies }, null, 2)
  );
  run("npm", ["install", "--prefix", project], { cwd: project });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? project,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8"
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed\nstdout:\n${redact(result.stdout)}\nstderr:\n${redact(result.stderr)}`
    );
  }
  return result;
}

function score(name, passed) {
  scores.push({ name, passed: Boolean(passed) });
}

function writeSummary(summary) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = join(outputRoot, `${timestamp}-${scenario}.json`);
  writeFileSync(
    outputPath,
    `${JSON.stringify({ ...summary, transcript }, null, 2)}\n`
  );
  process.stdout.write(`${JSON.stringify({ ...summary, outputPath }, null, 2)}\n`);
}

function transcriptText() {
  return JSON.stringify(transcript);
}

function redact(value) {
  return String(value ?? "").replaceAll(secretValue, "[REDACTED_SECRET]");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeIdentifier(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}
