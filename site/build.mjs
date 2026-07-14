#!/usr/bin/env node
// Static site build: landing page, docs pages rendered from the repo's
// markdown, and llms.txt copies. Output goes to site/dist (deployable as-is).
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
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

// Shared site shell, landing page, and agent-readable docs files.
copyFileSync(join(siteDir, "src", "index.html"), join(distDir, "index.html"));
copyFileSync(join(siteDir, "src", "styles.css"), join(distDir, "styles.css"));
for (const name of ["llms.txt", "llms-full.txt"]) {
  const source = join(repoRoot, name);
  if (existsSync(source)) {
    copyFileSync(source, join(distDir, name));
  }
}
const assetsDir = join(siteDir, "src", "assets");
if (existsSync(assetsDir)) {
  cpSync(assetsDir, join(distDir, "assets"), { recursive: true });
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

// Docs link each other by repo-relative .md path; map those to site URLs.
// Pages emit as docs/<slug>/index.html so extension-less URLs work on any
// static host, not just ones with a cleanUrls rewrite.
const slugBySource = new Map(
  built.map((entry) => [entry.source, `/docs/${entry.slug}`])
);

function rewriteDocLink(href, sourceDir) {
  if (!href || /^(https?:|mailto:|#|\/)/.test(href)) {
    return href;
  }
  const [pathPart, fragment] = href.split("#");
  const resolved = posix
    .normalize(posix.join(sourceDir, pathPart))
    .replace(/^(\.\.\/)+/, "");
  const mapped = slugBySource.get(resolved);
  if (mapped) {
    return fragment ? `${mapped}#${fragment}` : mapped;
  }
  // A repo file that is not on the docs site: send to GitHub.
  return `https://github.com/wkoverfield/switchboard/blob/main/${resolved}`;
}

for (const entry of built) {
  const markdown = readFileSync(join(repoRoot, entry.source), "utf8");
  const sourceDir = posix.dirname(entry.source);
  const tokens = marked.lexer(markdown);
  marked.walkTokens(tokens, (token) => {
    if (token.type === "link" || token.type === "image") {
      token.href = rewriteDocLink(token.href, sourceDir);
    }
  });
  const body = marked.parser(tokens);
  const pageDir = join(distDir, "docs", entry.slug);
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(
    join(pageDir, "index.html"),
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
        .map((entry) => {
          const current = entry.slug === active;
          return `<a class="${current ? "active" : ""}" href="/docs/${entry.slug}"${current ? ' aria-current="page"' : ""}>${escapeHtml(entry.title)}</a>`;
        })
        .join("\n");
      return `<div class="docs-nav-section"><span>${escapeHtml(section)}</span>\n${items}</div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Switchboard Docs</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23171c22'/%3E%3Ctext x='32' y='43' text-anchor='middle' font-family='monospace' font-size='38' font-weight='700' fill='%2378a892'%3Es%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&amp;family=JetBrains+Mono:wght@400;500;600&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
</head>
<body class="docs-body">
<nav class="site-nav" aria-label="Primary navigation">
  <div class="wrap site-nav-row">
    <a class="wordmark" href="/" aria-label="Switchboard home">switchboard</a>
    <div class="site-nav-links">
      <a class="nav-link" href="/docs/" aria-current="page">Docs</a>
      <a class="nav-link nav-github" href="https://github.com/wkoverfield/switchboard">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.386-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297 24 5.67 18.627.297 12 .297Z"/></svg>
        GitHub
      </a>
      <a class="button button-accent button-small" href="/docs/install-quickstart">Install</a>
    </div>
  </div>
</nav>
<div class="docs-layout">
  <aside class="docs-sidebar" aria-label="Documentation navigation">
${nav}
  </aside>
  <main class="docs-main">
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
