#!/usr/bin/env node
// Static site build: landing page, docs pages rendered from the repo's
// markdown, and llms.txt copies. Output goes to site/dist (deployable as-is).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { marked } from "marked";

const siteDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(siteDir, "..");
const distDir = join(siteDir, "dist");

// slug becomes /docs/<slug>; source is repo-relative markdown.
const docsManifest = [
  { section: "Start", slug: "install-quickstart", source: "docs/install/quickstart.md", title: "Quickstart" },
  { section: "Start", slug: "install-claude-code", source: "docs/install/claude-code.md", title: "Claude Code" },
  { section: "Start", slug: "install-codex", source: "docs/install/codex.md", title: "Codex" },
  { section: "Start", slug: "install-cursor", source: "docs/install/cursor.md", title: "Cursor" },
  { section: "Start", slug: "install-vscode", source: "docs/install/vscode.md", title: "VS Code" },
  { section: "Security", slug: "security-threat-model", source: "docs/security/threat-model.md", title: "Threat Model" },
  { section: "Security", slug: "security-trust-model", source: "docs/security/trust-model.md", title: "Trust Model" },
  { section: "Security", slug: "security-audit-logs", source: "docs/security/audit-logs.md", title: "Audit Logs" },
  { section: "Security", slug: "security-secrets", source: "docs/security/secrets-keychain-architecture.md", title: "Secrets and Keychain" },
  { section: "Reference", slug: "daemon", source: "docs/daemon.md", title: "Daemon Lifecycle" },
  { section: "Reference", slug: "for-agents", source: "docs/for-agents.md", title: "For Agents" },
  { section: "Reference", slug: "provider-safety-templates", source: "docs/providers/safety-templates.md", title: "Provider Safety Templates" },
  { section: "Reference", slug: "harness-json-contracts", source: "docs/use-cases/harness-json-contracts.md", title: "Harness JSON Contracts" },
  { section: "Product", slug: "roadmap", source: "docs/product/public-roadmap.md", title: "Roadmap" }
];

rmSync(distDir, { recursive: true, force: true });
mkdirSync(join(distDir, "docs"), { recursive: true });

// Landing page and llms files.
copyFileSync(join(siteDir, "src", "index.html"), join(distDir, "index.html"));
for (const name of ["llms.txt", "llms-full.txt"]) {
  const source = join(repoRoot, name);
  if (existsSync(source)) {
    copyFileSync(source, join(distDir, name));
  }
}

// Docs pages.
const built = [];
for (const entry of docsManifest) {
  const sourcePath = join(repoRoot, entry.source);
  if (!existsSync(sourcePath)) {
    process.stderr.write(`site build: skipping missing ${entry.source}\n`);
    continue;
  }
  built.push(entry);
}

for (const entry of built) {
  const markdown = readFileSync(join(repoRoot, entry.source), "utf8");
  const body = marked.parse(markdown, { async: false });
  writeFileSync(
    join(distDir, "docs", `${entry.slug}.html`),
    docShell({ title: entry.title, body, active: entry.slug, entries: built })
  );
}

writeFileSync(
  join(distDir, "docs", "index.html"),
  docShell({
    title: "Docs",
    body: docsIndexBody(built),
    active: "index",
    entries: built
  })
);

process.stderr.write(`site build: ${built.length} docs pages + landing -> ${distDir}\n`);

function docsIndexBody(entries) {
  const sections = [...new Set(entries.map((entry) => entry.section))];
  const parts = [
    "<h1>Switchboard Docs</h1>",
    "<p>Everything here also ships to agents: <code>npx -y @switchboard-mcp/docs-mcp</code> serves these pages as MCP tools, and <a href=\"/llms.txt\">llms.txt</a> is kept current.</p>"
  ];
  for (const section of sections) {
    parts.push(`<h2>${escapeHtml(section)}</h2><ul>`);
    for (const entry of entries.filter((item) => item.section === section)) {
      parts.push(`<li><a href="/docs/${entry.slug}">${escapeHtml(entry.title)}</a></li>`);
    }
    parts.push("</ul>");
  }
  return parts.join("\n");
}

function docShell({ title, body, active, entries }) {
  const sections = [...new Set(entries.map((entry) => entry.section))];
  const nav = sections
    .map((section) => {
      const items = entries
        .filter((entry) => entry.section === section)
        .map(
          (entry) =>
            `<a class="${entry.slug === active ? "active" : ""}" href="/docs/${entry.slug}">${escapeHtml(entry.title)}</a>`
        )
        .join("\n");
      return `<div class="nav-section"><span>${escapeHtml(section)}</span>\n${items}</div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Switchboard Docs</title>
<style>
  :root {
    --bg: #0b0e12; --panel: #11161d; --line: #1e2630;
    --text: #d7dee8; --dim: #8b98a7; --green: #3fd68f; --red: #ff5f6d; --yellow: #f2c94c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.65;
  }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  a { color: var(--green); text-decoration: none; }
  a:hover { text-decoration: underline; }
  header {
    display: flex; align-items: center; gap: 18px;
    padding: 14px 24px; border-bottom: 1px solid var(--line);
  }
  .wordmark { font-weight: 700; letter-spacing: 0.05em; color: var(--text); font-family: ui-monospace, Menlo, monospace; }
  .wordmark b { color: var(--green); font-weight: 700; }
  header .links { margin-left: auto; display: flex; gap: 16px; font-size: 0.9rem; }
  header .links a { color: var(--dim); }
  .layout { display: grid; grid-template-columns: 240px 1fr; max-width: 1140px; margin: 0 auto; }
  @media (max-width: 860px) { .layout { grid-template-columns: 1fr; } aside { display: none; } }
  aside {
    border-right: 1px solid var(--line); padding: 26px 18px; font-size: 0.9rem;
    position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto;
  }
  .nav-section { margin-bottom: 20px; display: flex; flex-direction: column; gap: 4px; }
  .nav-section span {
    color: var(--dim); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em;
    margin-bottom: 4px;
  }
  .nav-section a { color: var(--text); padding: 3px 8px; border-radius: 6px; }
  .nav-section a:hover { background: var(--panel); text-decoration: none; }
  .nav-section a.active { background: var(--panel); color: var(--green); }
  main { padding: 30px 34px 80px; min-width: 0; }
  main h1 { letter-spacing: -0.01em; line-height: 1.2; }
  main h1, main h2, main h3 { scroll-margin-top: 20px; }
  main h2 { margin-top: 2.2em; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
  main pre {
    background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px 16px; overflow-x: auto; font-size: 0.86rem; line-height: 1.55;
  }
  main code { background: var(--panel); border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px; font-size: 0.88em; }
  main pre code { background: none; border: none; padding: 0; }
  main table { border-collapse: collapse; width: 100%; font-size: 0.92rem; display: block; overflow-x: auto; }
  main th, main td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
  main th { background: var(--panel); }
  main blockquote { border-left: 3px solid var(--line); margin: 0; padding: 2px 18px; color: var(--dim); }
  main img { max-width: 100%; }
</style>
</head>
<body>
<header>
  <a href="/" class="wordmark">switchboard<b>_</b></a>
  <div class="links">
    <a href="/docs/">Docs</a>
    <a href="/docs/roadmap">Roadmap</a>
    <a href="https://github.com/wkoverfield/switchboard">GitHub</a>
    <a href="https://www.npmjs.com/package/@switchboard-mcp/cli">npm</a>
  </div>
</header>
<div class="layout">
  <aside>
${nav}
  </aside>
  <main>
${body}
  </main>
</div>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
