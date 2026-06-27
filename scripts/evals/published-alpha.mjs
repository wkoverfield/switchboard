#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const packageSpec = process.argv[2] ?? "@switchboard-mcp/cli@0.1.0";
const repo = resolve(import.meta.dirname, "..", "..");
const outputRoot = join(repo, ".switchboard-evals");
const root = mkdtempSync(join(tmpdir(), "switchboard-published-alpha-"));
const installDir = join(root, "install");
const cacheDir = join(root, ".npm-cache");
const stateHome = join(root, ".state");
const transcript = [];
const scores = [];
const rawSecret = "ghp_published_alpha_eval_should_not_print";

mkdirSync(outputRoot, { recursive: true });
mkdirSync(installDir, { recursive: true });

try {
  installPublishedCli();
  const cliPath = join(installDir, "node_modules", ".bin", "switchboard");
  score("published CLI installed", existsSync(cliPath));
  score("published CLI reports version", runCli(["--version"]).stdout.trim() === "0.1.0");

  const cleanRepo = createRepo("clean", "main");
  const cleanScan = runCliJson(["--cwd", cleanRepo, "scan", "--json"]);
  score("clean scan returns next actions", cleanScan.nextActions?.length > 0);
  score(
    "clean scan suggests setup or import",
    (cleanScan.nextActions ?? []).some((action) =>
      /switchboard (setup|import|install)/.test(action)
    )
  );

  const messyRepo = createRepo("messy", "main");
  writeMessyMcpConfig(messyRepo);
  const importPlan = runCliJson(["--cwd", messyRepo, "import", "--dry-run", "--json"]);
  score("import dry-run detects MCP config", (importPlan.actions ?? []).length > 0);
  score("import dry-run redacts raw secrets", !JSON.stringify(importPlan).includes(rawSecret));
  score("import dry-run exposes structured commands", Boolean(importPlan.commands));
  score(
    "import dry-run explains safety",
    JSON.stringify(importPlan.safetyNotes ?? []).toLowerCase().includes("secret")
  );

  const providerRepo = createRepo("provider", "main");
  const repoSlug = safeIdentifier(basename(providerRepo));
  const profileName = `github_${repoSlug}_ci`;
  const secretRef = `github/${repoSlug}/dev/token`;
  const addPlan = runCliJson([
    "--cwd",
    providerRepo,
    "add",
    "github-ci",
    "--profile-name",
    profileName,
    "--secret-ref",
    secretRef,
    "--command",
    process.execPath,
    "--arg",
    "-e",
    "--arg",
    "process.exit(0)",
    "--write",
    "--json"
  ]);
  score("provider add writes repo-scoped profile", addPlan.profileName === profileName);
  score("provider add includes structured commands", Boolean(addPlan.commands));
  score(
    "provider add points at mandate creation",
    JSON.stringify(addPlan.commands ?? {}).includes("mandate")
  );
  const mandate = runCliJson([
    "--cwd",
    providerRepo,
    "mandate",
    "create",
    "--from",
    "github-ci",
    "--profiles",
    profileName,
    "--json"
  ]);
  score("mandate create returns workspaceLease", mandate.workspaceLease?.schemaVersion === "switchboard.workspace-lease.v1");
  score("workspaceLease includes mcpLaunch", Boolean(mandate.workspaceLease?.mcpLaunch?.args));
  score("workspaceLease preserves authority profile", mandate.workspaceLease?.authority?.profiles?.includes(profileName));

  const npxVersion = run("npm", [
    "exec",
    "--yes",
    "--package",
    packageSpec,
    "--cache",
    cacheDir,
    "--",
    "switchboard",
    "--version"
  ]).stdout.trim();
  score("npx/npm exec works", npxVersion === "0.1.0");

  score("transcript avoids raw secret", !transcriptText().includes(rawSecret));

  const summary = {
    schemaVersion: "switchboard.published-alpha-eval.v1",
    packageSpec,
    passed: scores.every((entry) => entry.passed),
    scores,
    result: {
      cleanNextActions: cleanScan.nextActions ?? [],
      importActionCount: importPlan.actions?.length ?? 0,
      providerProfile: profileName,
      mandateId: mandate.mandate?.id ?? null
    }
  };
  writeSummary(summary);
  if (!summary.passed) {
    process.exitCode = 1;
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

function installPublishedCli() {
  run("npm", [
    "install",
    packageSpec,
    "--registry=https://registry.npmjs.org/",
    "--cache",
    cacheDir
  ], { cwd: installDir });
}

function createRepo(name, branch) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  run("git", ["init", "-b", branch], { cwd: dir });
  run("git", ["remote", "add", "origin", `https://github.com/example/${name}.git`], {
    cwd: dir
  });
  writeFileSync(join(dir, ".gitignore"), ".switchboard.local.yaml\n");
  return dir;
}

function writeMessyMcpConfig(dir) {
  mkdirSync(join(dir, ".codex"), { recursive: true });
  mkdirSync(join(dir, ".vercel"), { recursive: true });
  writeFileSync(join(dir, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_test" }));
  writeFileSync(
    join(dir, ".codex", "config.toml"),
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
    join(dir, ".mcp.json"),
    `${JSON.stringify(
      {
        mcpServers: {
          github: {
            command: "docker",
            args: ["run", "-i", "ghcr.io/github/github-mcp-server"],
            env: {
              GITHUB_PERSONAL_ACCESS_TOKEN: rawSecret
            }
          }
        }
      },
      null,
      2
    )}\n`
  );
}

function runCliJson(args) {
  return JSON.parse(runCli(args).stdout);
}

function runCli(args) {
  const cliPath = join(installDir, "node_modules", ".bin", "switchboard");
  transcript.push({ role: "agent", command: ["switchboard", ...args].join(" ") });
  const result = run(cliPath, args, {
    env: { ...process.env, XDG_STATE_HOME: stateHome, XDG_CONFIG_HOME: join(root, ".config") }
  });
  transcript.push({
    role: "tool",
    exitCode: result.status,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr)
  });
  return result;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: "utf8"
  });
  if (result.status !== 0) {
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
  const outputPath = join(outputRoot, `${timestamp}-published-alpha.json`);
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
  return String(value ?? "").replaceAll(rawSecret, "[REDACTED_SECRET]");
}

function safeIdentifier(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}
