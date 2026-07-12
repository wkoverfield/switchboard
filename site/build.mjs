#!/usr/bin/env node
// Static site build: landing page, docs pages rendered from the repo's
// markdown, and llms.txt copies. Output goes to site/dist (deployable as-is).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
<link rel="preconnect" href="https://api.fontshare.com">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    /* credential-paper tokens, mirrored from the landing page */
    --paper: #f7f5f0; --paper-raised: #fdfcfa;
    --hairline: #e6e2d9; --hairline-dark: #d8d3c8;
    --ink: #1c1a17; --ink-dim: #6b665e;
    --grant: #166b41; --stamp: #b02a2a;
    --term-bg: #14120f; --term-ink: #d8d4cc;
    --font-sans: "General Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font-family: var(--font-sans);
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
  }
  code, pre { font-family: var(--font-mono); }
  a { color: var(--ink); text-decoration: underline; text-decoration-color: var(--hairline-dark); text-underline-offset: 3px; }
  a:hover { text-decoration-color: var(--ink); }
  header {
    display: flex; align-items: center; gap: 18px;
    padding: 15px 24px; border-bottom: 1px solid var(--hairline);
    background: var(--paper); position: sticky; top: 0; z-index: 10;
  }
  .wordmark { font-weight: 500; font-size: 0.95rem; color: var(--ink); font-family: var(--font-mono); text-decoration: none; }
  .wordmark b { color: var(--grant); font-weight: 500; }
  header .links { margin-left: auto; display: flex; gap: 18px; font-size: 0.88rem; }
  header .links a { color: var(--ink-dim); text-decoration: none; }
  header .links a:hover { color: var(--ink); }
  header .links a.gh { display: inline-flex; align-items: center; }
  .layout { display: grid; grid-template-columns: 240px 1fr; max-width: 1140px; margin: 0 auto; }
  @media (max-width: 860px) { .layout { grid-template-columns: 1fr; } aside { display: none; } }
  aside {
    border-right: 1px solid var(--hairline); padding: 28px 18px; font-size: 0.88rem;
    position: sticky; top: 53px; align-self: start; height: calc(100vh - 53px); overflow-y: auto;
  }
  .nav-section { margin-bottom: 22px; display: flex; flex-direction: column; gap: 3px; }
  .nav-section span {
    color: var(--ink-dim); font-family: var(--font-mono);
    font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.14em;
    margin-bottom: 6px;
  }
  .nav-section a { color: var(--ink); padding: 3px 8px; border-radius: 6px; text-decoration: none; }
  .nav-section a:hover { background: var(--paper-raised); }
  .nav-section a.active { background: var(--paper-raised); color: var(--grant); box-shadow: inset 2px 0 0 var(--grant); }
  main { padding: 34px 38px 90px; min-width: 0; }
  main h1 { letter-spacing: -0.02em; line-height: 1.15; font-weight: 600; }
  main h1, main h2, main h3 { scroll-margin-top: 70px; }
  main h2 { margin-top: 2.2em; border-bottom: 1px solid var(--hairline); padding-bottom: 6px; font-weight: 600; letter-spacing: -0.01em; }
  main h3 { font-weight: 600; }
  main pre {
    background: var(--term-bg); color: var(--term-ink);
    border-radius: 8px;
    padding: 14px 16px; overflow-x: auto; font-size: 0.84rem; line-height: 1.55;
  }
  main code { background: var(--paper-raised); border: 1px solid var(--hairline); border-radius: 4px; padding: 1px 5px; font-size: 0.86em; }
  main pre code { background: none; border: none; padding: 0; color: inherit; }
  main table { border-collapse: collapse; width: 100%; font-size: 0.92rem; display: block; overflow-x: auto; }
  main th, main td { border: 1px solid var(--hairline-dark); padding: 8px 10px; text-align: left; vertical-align: top; }
  main th { background: var(--paper-raised); }
  main blockquote { border-left: 3px solid var(--hairline-dark); margin: 0; padding: 2px 18px; color: var(--ink-dim); }
  main img { max-width: 100%; }
</style>
</head>
<body>
<header>
  <a href="/" class="wordmark">switchboard<b>_</b></a>
  <div class="links">
    <a href="/docs/">Docs</a>
    <a href="/docs/roadmap">Roadmap</a>
    <a class="gh" href="https://github.com/wkoverfield/switchboard" aria-label="Switchboard on GitHub"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12c0 5.303 3.438 9.8 8.205 11.385c.6.113.82-.258.82-.577c0-.285-.01-1.04-.015-2.04c-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729c1.205.084 1.838 1.236 1.838 1.236c1.07 1.835 2.809 1.305 3.495.998c.108-.776.417-1.305.76-1.605c-2.665-.3-5.466-1.332-5.466-5.93c0-1.31.465-2.38 1.235-3.22c-.135-.303-.54-1.523.105-3.176c0 0 1.005-.322 3.3 1.23c.96-.267 1.98-.399 3-.405c1.02.006 2.04.138 3 .405c2.28-1.552 3.285-1.23 3.285-1.23c.645 1.653.24 2.873.12 3.176c.765.84 1.23 1.91 1.23 3.22c0 4.61-2.805 5.625-5.475 5.92c.42.36.81 1.096.81 2.22c0 1.606-.015 2.896-.015 3.286c0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></a>
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
