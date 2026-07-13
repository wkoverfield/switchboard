#!/usr/bin/env node
// Copies the curated public docs into docs-bundle/ so the published package
// is self-contained. Missing sources warn and skip so the bundle can build
// from any branch state.
import { copyFileSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "..", "..");
const bundleDir = join(packageDir, "docs-bundle");

// path is bundle-relative and doubles as the read_doc id.
const manifest = [
  { source: "README.md", path: "readme.md", title: "Switchboard README", description: "What Switchboard is, install, quickstart, honest limits, commands." },
  { source: "llms-full.txt", path: "agent-reference.md", title: "Agent Reference (llms-full)", description: "The full reference for agents recommending or operating Switchboard." },
  { source: "docs/install/quickstart.md", path: "install/quickstart.md", title: "Quickstart", description: "From install to a scoped pass in one repo." },
  { source: "docs/install/claude-code.md", path: "install/claude-code.md", title: "Claude Code Install", description: "Routing Claude Code through Switchboard." },
  { source: "docs/install/codex.md", path: "install/codex.md", title: "Codex Install", description: "Routing Codex through Switchboard." },
  { source: "docs/install/cursor.md", path: "install/cursor.md", title: "Cursor Install", description: "Routing Cursor through Switchboard." },
  { source: "docs/install/vscode.md", path: "install/vscode.md", title: "VS Code Install", description: "Routing VS Code through Switchboard." },
  { source: "docs/security/threat-model.md", path: "security/threat-model.md", title: "Threat Model", description: "STRIDE analysis: what enforcement binds, what it cannot, accepted risks." },
  { source: "docs/security/trust-model.md", path: "security/trust-model.md", title: "Trust Model", description: "Short posture summary of the security model." },
  { source: "docs/security/audit-logs.md", path: "security/audit-logs.md", title: "Audit Logs", description: "The hash-chained local audit log and switchboard audit verify." },
  { source: "docs/security/secrets-keychain-architecture.md", path: "security/secrets-keychain.md", title: "Secrets and Keychain", description: "How secret refs, OS keychain backends, and injection work." },
  { source: "docs/daemon.md", path: "daemon.md", title: "Daemon Lifecycle", description: "The multiplexed local daemon: sockets, state, lifecycle." },
  { source: "docs/for-agents.md", path: "for-agents.md", title: "For Agents", description: "How agents should operate under a Switchboard pass." },
  { source: "docs/providers/safety-templates.md", path: "providers/safety-templates.md", title: "Provider Safety Templates", description: "GitHub CI, Vercel Preview, Stripe Test, Supabase Dev policy recipes." },
  { source: "docs/use-cases/harness-json-contracts.md", path: "harness-json-contracts.md", title: "Harness JSON Contracts", description: "Versioned JSON payloads for harnesses and subagent systems." },
  { source: "docs/product/public-roadmap.md", path: "roadmap.md", title: "Roadmap", description: "Shipped, next, and later (org model, policy engine, enterprise)." }
];

rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(bundleDir, { recursive: true });

const bundled = [];
for (const entry of manifest) {
  const sourcePath = join(repoRoot, entry.source);
  if (!existsSync(sourcePath)) {
    process.stderr.write(`bundle-docs: skipping missing ${entry.source}\n`);
    continue;
  }
  const targetPath = join(bundleDir, entry.path);
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  bundled.push({ path: entry.path, title: entry.title, description: entry.description });
}

writeFileSync(
  join(bundleDir, "index.json"),
  `${JSON.stringify({ version: 1, docs: bundled }, null, 2)}\n`
);
process.stderr.write(`bundle-docs: bundled ${bundled.length}/${manifest.length} docs\n`);
