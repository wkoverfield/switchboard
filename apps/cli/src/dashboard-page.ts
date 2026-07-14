export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="application-name" content="SWITCHBOARD">
<title>SWITCHBOARD · Local dashboard</title>
<style>
  :root {
    --bg: #0e1114;
    --bg-2: #12161a;
    --sunk: #121519;
    --panel: #171c22;
    --panel-raised: #1c222a;
    --line: #242c34;
    --line-strong: #303945;
    --ink: #e8ecf1;
    --ink-muted: #a7b0bc;
    --ink-faint: #7c8795;
    --accent: #78a892;
    --accent-hover: #88b7a2;
    --allow: #7cb59a;
    --allow-bg: rgb(124 181 154 / 13%);
    --allow-line: rgb(124 181 154 / 30%);
    --gate: #d3ad60;
    --gate-bg: rgb(211 173 96 / 13%);
    --gate-line: rgb(211 173 96 / 30%);
    --deny: #d67d72;
    --deny-bg: rgb(214 125 114 / 13%);
    --deny-line: rgb(214 125 114 / 30%);
    --sans: "Hanken Grotesk", "Avenir Next", Avenir, "Segoe UI", sans-serif;
    --mono: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    font-size: 15px;
  }

  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--sans);
    -webkit-font-smoothing: antialiased;
  }
  button, input { font: inherit; }
  button { color: inherit; }
  code { font-family: var(--mono); }
  a { color: inherit; text-decoration: none; }
  :focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 3px; }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .label {
    color: var(--ink-faint);
    font-family: var(--mono);
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .shell { display: flex; min-height: 100vh; }
  .rail {
    position: sticky;
    top: 0;
    display: flex;
    width: 222px;
    height: 100vh;
    flex: 0 0 222px;
    flex-direction: column;
    border-right: 1px solid var(--line);
    background: var(--panel);
  }
  .rail-head {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 18px 16px 15px;
    border-bottom: 1px solid var(--line);
  }
  .wordmark {
    font-family: var(--mono);
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .rail-head .label { font-size: 0.62rem; }
  .rail-nav {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 12px;
  }
  .rail-title { padding: 8px 11px 4px; font-size: 0.64rem; }
  .nav-item {
    display: flex;
    min-height: 42px;
    align-items: center;
    gap: 11px;
    padding: 8px 11px;
    border-radius: 9px;
    color: var(--ink-muted);
    font-size: 0.9rem;
    font-weight: 500;
    transition: background-color 140ms ease, color 140ms ease;
  }
  .nav-item svg { width: 17px; height: 17px; flex: 0 0 auto; }
  .nav-item.active { background: rgb(120 168 146 / 13%); color: var(--accent-hover); }
  .nav-count {
    min-width: 26px;
    margin-left: auto;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--sunk);
    color: var(--ink-muted);
    font-family: var(--mono);
    font-size: 0.68rem;
    text-align: center;
  }
  .nav-item.active .nav-count { background: rgb(120 168 146 / 20%); color: var(--accent-hover); }
  .nav-count.pending { background: var(--gate-bg); color: var(--gate); }
  .rail-foot {
    margin-top: auto;
    padding: 16px;
    border-top: 1px solid var(--line);
  }
  .rail-status { display: flex; align-items: center; gap: 8px; }
  .status-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--allow); }
  .rail-address { display: block; margin-top: 7px; font-size: 0.62rem; }
  .app { display: flex; min-width: 0; flex: 1; flex-direction: column; }
  .topbar {
    position: sticky;
    z-index: 10;
    top: 0;
    display: flex;
    min-height: 72px;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    padding: 14px 28px;
    border-bottom: 1px solid var(--line);
    background: rgb(14 17 20 / 86%);
    -webkit-backdrop-filter: blur(10px) saturate(160%);
    backdrop-filter: blur(10px) saturate(160%);
  }
  .mobile-wordmark { display: none; }
  .topbar h1 { margin: 0; font-size: 1.55rem; font-weight: 700; letter-spacing: -0.025em; line-height: 1; }
  .topbar-sub { margin-top: 5px; color: var(--ink-faint); font-size: 0.84rem; }
  .mode { color: var(--allow); }
  .mode.idle { color: var(--ink-muted); }
  .mode.degraded { color: var(--deny); }
  .enforcement { color: var(--ink-muted); }
  .enforcement.strict { color: var(--gate); }
  .topbar-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }
  .chip {
    display: inline-flex;
    min-height: 40px;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    border: 1px solid var(--line-strong);
    border-radius: 9px;
    background: var(--panel);
    color: var(--ink-muted);
    font-family: var(--mono);
    font-size: 0.72rem;
  }
  button.chip { cursor: pointer; transition: transform 120ms var(--ease-out), background-color 140ms ease, color 140ms ease; }
  button.chip:active { transform: scale(0.97); }
  .chip svg { width: 15px; height: 15px; }
  .chain-chip { border-color: var(--allow-line); background: var(--allow-bg); color: var(--allow); }
  .filter-row { width: 100%; }
  .filter-row[hidden] { display: none; }
  .filter-field { position: relative; display: block; max-width: 520px; margin-left: auto; }
  .filter-field svg {
    position: absolute;
    top: 50%;
    left: 13px;
    width: 15px;
    height: 15px;
    color: var(--ink-faint);
    transform: translateY(-50%);
    pointer-events: none;
  }
  .filter-field input {
    width: 100%;
    min-height: 42px;
    padding: 0 14px 0 38px;
    border: 1px solid var(--line-strong);
    border-radius: 9px;
    background: var(--sunk);
    color: var(--ink);
  }
  .filter-field input::placeholder { color: var(--ink-faint); }
  .content { display: flex; flex-direction: column; gap: 20px; padding: 24px 28px 40px; }
  .canvas { display: grid; grid-template-columns: minmax(320px, 400px) minmax(0, 1fr); align-items: start; gap: 20px; }
  .stack { display: flex; min-width: 0; flex-direction: column; gap: 20px; }
  .panel { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); scroll-margin-top: 96px; }
  .panel-head {
    display: flex;
    min-height: 52px;
    flex-wrap: wrap;
    align-items: center;
    gap: 9px;
    padding: 11px 18px;
    border-bottom: 1px solid var(--line);
  }
  .panel-head h2 { margin: 0; color: var(--ink); font-size: 0.72rem; }
  .panel-count {
    margin-left: auto;
    padding: 3px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--sunk);
    color: var(--ink-muted);
    font-family: var(--mono);
    font-size: 0.68rem;
  }
  .panel-count.pending { color: var(--gate); }
  .audit-counts { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; font-family: var(--mono); font-size: 0.68rem; }
  .audit-counts .allowed { color: var(--allow); }
  .audit-counts .gated { color: var(--gate); }
  .audit-counts .denied, .audit-counts .errors { color: var(--deny); }
  .audit-counts .separator { color: var(--ink-faint); }
  .stream-note { color: var(--ink-faint); font-size: 0.64rem; }
  .empty { padding: 22px 18px; color: var(--ink-muted); font-size: 0.88rem; line-height: 1.55; }
  .health-note {
    padding: 12px 15px;
    border: 1px solid var(--deny-line);
    border-radius: 10px;
    background: var(--deny-bg);
    color: var(--deny);
    font-family: var(--mono);
    font-size: 0.72rem;
    line-height: 1.55;
  }
  .pass + .pass { border-top: 1px solid var(--line); }
  .pass-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; padding: 16px 18px 4px; }
  .pass-title .label { font-size: 0.62rem; }
  .pass-id { font-family: var(--mono); font-size: 0.98rem; font-weight: 500; }
  .pass-branch { color: var(--ink-muted); font-family: var(--mono); font-size: 0.8rem; }
  .pass-meta { padding: 0 18px 13px; color: var(--ink-faint); font-size: 0.8rem; line-height: 1.5; overflow-wrap: anywhere; }
  .policy-head, .policy-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; }
  .policy-head { padding: 9px 18px 6px; border-top: 1px solid var(--line); }
  .policy-head .label { font-size: 0.62rem; }
  .policy-row { min-height: 42px; padding: 7px 18px; border-top: 1px solid var(--line); }
  .policy-tool { overflow-wrap: anywhere; color: var(--ink); font-family: var(--mono); font-size: 0.75rem; }
  .policy-tool.muted { color: var(--ink-muted); }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid;
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .state-allowed { border-color: var(--allow-line); background: var(--allow-bg); color: var(--allow); }
  .state-gated { border-color: var(--gate-line); background: var(--gate-bg); color: var(--gate); }
  .state-denied, .state-error { border-color: var(--deny-line); background: var(--deny-bg); color: var(--deny); }
  .state-cancelled { border-color: var(--line-strong); background: var(--sunk); color: var(--ink-muted); }
  .state-glyph { font-size: 0.68rem; }
  .lease { padding: 13px 18px 15px; border-top: 1px solid var(--line); background: var(--sunk); }
  .lease-meta { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 8px; color: var(--ink-faint); font-family: var(--mono); font-size: 0.68rem; }
  .lease-expiry { color: var(--gate); }
  .lease-track { height: 6px; overflow: hidden; border-radius: 3px; background: var(--line-strong); }
  .lease-fill { height: 100%; border-radius: inherit; background: var(--accent); }
  .approval { padding: 16px 18px; }
  .approval + .approval { border-top: 1px solid var(--line); }
  .approval-title { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
  .approval-tool { overflow-wrap: anywhere; font-family: var(--mono); font-size: 0.8rem; }
  .approval-meta { margin-top: 10px; color: var(--ink-faint); font-family: var(--mono); font-size: 0.7rem; line-height: 1.5; overflow-wrap: anywhere; }
  .approval-command { margin-top: 10px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--sunk); color: var(--ink); font-family: var(--mono); font-size: 0.72rem; overflow-wrap: anywhere; }
  .approval-command strong { color: var(--allow); font-weight: 500; }
  .audit-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  th {
    padding: 9px 10px;
    border-bottom: 1px solid var(--line);
    color: var(--ink-faint);
    font-family: var(--mono);
    font-size: 0.62rem;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-align: left;
    text-transform: uppercase;
  }
  th:first-child { padding-left: 18px; }
  th:last-child { padding-right: 18px; }
  td { padding: 12px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tbody tr:last-child td { border-bottom: 0; }
  .audit-time, .audit-action { width: 1%; color: var(--ink-faint); font-family: var(--mono); font-size: 0.7rem; white-space: nowrap; }
  .audit-time { padding-left: 18px; }
  .audit-state { width: 1%; white-space: nowrap; }
  .audit-detail { padding-right: 18px; overflow-wrap: anywhere; }
  .audit-tool { color: var(--ink); font-family: var(--mono); font-size: 0.76rem; }
  .audit-pass { margin-left: 4px; color: var(--ink-faint); font-family: var(--mono); font-size: 0.68rem; }
  .audit-reason { margin-top: 5px; color: var(--ink-muted); font-family: var(--mono); font-size: 0.7rem; line-height: 1.45; }
  .mobile-label { display: none; }
  .privacy-note { display: flex; align-items: center; gap: 9px; padding: 2px 4px; color: var(--ink-faint); font-family: var(--mono); font-size: 0.66rem; line-height: 1.55; }
  .privacy-note code { color: var(--ink-muted); }

  @media (hover: hover) and (pointer: fine) {
    .nav-item:hover, button.chip:hover { background: var(--sunk); color: var(--ink); }
  }
  @media (max-width: 860px) {
    .canvas { grid-template-columns: 1fr; }
  }
  @media (max-width: 720px) {
    .rail { display: none; }
    .mobile-wordmark { display: block; width: 100%; color: var(--ink-muted); }
    .topbar { padding-inline: 20px; }
    .content { padding-inline: 20px; }
  }
  @media (max-width: 600px) {
    .topbar-actions { width: 100%; margin-left: 0; }
    .topbar-actions .chip { flex: 1; justify-content: center; }
    .content { padding: 16px 14px 30px; }
    .panel { border-radius: 13px; }
    .panel-head { padding-inline: 14px; }
    .pass-title, .pass-meta, .policy-head, .policy-row, .lease, .approval { padding-right: 14px; padding-left: 14px; }
    .policy-row { grid-template-columns: 1fr; }
    .policy-row .state { width: fit-content; }
    .lease-meta { flex-direction: column; gap: 3px; }
    .audit-scroll { overflow: visible; }
    table, tbody, tr, td { display: block; width: 100%; }
    thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
    }
    tbody tr { display: grid; grid-template-columns: auto 1fr; gap: 7px 10px; padding: 14px; border-bottom: 1px solid var(--line); }
    tbody tr:last-child { border-bottom: 0; }
    td { padding: 0; border: 0; }
    .mobile-label { display: block; margin-bottom: 3px; color: var(--ink-faint); font-family: var(--mono); font-size: 0.66rem; letter-spacing: 0.08em; text-transform: uppercase; }
    .audit-time, .audit-state, .audit-action { width: auto; padding: 0; white-space: normal; }
    .audit-detail { grid-column: 1 / -1; padding: 0; }
    .privacy-note { display: block; padding-inline: 2px; }
    .privacy-note code { display: inline; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    button.chip:active { transform: none; }
  }
</style>
</head>
<body>
<div class="shell">
  <aside class="rail">
    <div class="rail-head">
      <span class="wordmark">switchboard</span>
      <span class="label">local · read-only</span>
    </div>
    <nav class="rail-nav" aria-label="Dashboard sections">
      <span class="label rail-title">This machine</span>
      <a class="nav-item active" href="#overview" data-nav="overview" aria-current="page">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
        Overview
      </a>
      <a class="nav-item" href="#passes" data-nav="passes">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="8" cy="8" r="4"/><path d="M11 11l7 7M15 15l2-2"/></svg>
        Live passes <span class="nav-count" id="nav-passes">0</span>
      </a>
      <a class="nav-item" href="#approvals" data-nav="approvals">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3 7.5-8 9-5-1.5-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>
        Approvals <span class="nav-count" id="nav-approvals">0</span>
      </a>
      <a class="nav-item" href="#audit" data-nav="audit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 5h16M4 10h16M4 15h10M4 20h10"/></svg>
        Audit stream
      </a>
    </nav>
    <div class="rail-foot">
      <div class="rail-status"><span class="status-dot"></span><span class="label">dashboard running</span></div>
      <span class="label rail-address" id="local-address">127.0.0.1</span>
    </div>
  </aside>

  <div class="app">
    <header id="overview" class="topbar">
      <span class="wordmark mobile-wordmark">switchboard · local · read-only</span>
      <div>
        <h1>Overview</h1>
        <div class="topbar-sub">Machine activity · <span class="mode" id="mode-label">loading</span> · <span class="enforcement" id="enforcement-label">launch repo loading</span></div>
      </div>
      <div class="topbar-actions">
        <button class="chip" id="filter-toggle" type="button" aria-controls="filter-row" aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/></svg>
          Filter
        </button>
        <span class="chip chain-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
          Hash-chained · local
        </span>
      </div>
      <div class="filter-row" id="filter-row" hidden>
        <label class="filter-field">
          <span class="sr-only">Filter recent audit entries</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/></svg>
          <input id="audit-filter" type="search" autocomplete="off" placeholder="Filter by tool, pass, action, or reason">
        </label>
      </div>
    </header>

    <main class="content">
      <div class="health-note" id="health-note" role="status" hidden></div>
      <div class="canvas">
        <div class="stack">
          <section class="panel" id="passes" aria-labelledby="passes-title">
            <div class="panel-head">
              <span class="status-dot"></span>
              <h2 class="label" id="passes-title">Live passes</h2>
              <span class="panel-count" id="pass-count">0 active</span>
            </div>
            <div id="passes-content"><div class="empty">Loading local passes…</div></div>
          </section>

          <section class="panel" id="approvals" aria-labelledby="approvals-title">
            <div class="panel-head">
              <span class="status-dot" id="approval-dot"></span>
              <h2 class="label" id="approvals-title">Pending approvals</h2>
              <span class="panel-count" id="approval-count">0 waiting</span>
            </div>
            <div id="approvals-content"><div class="empty">Loading approval requests…</div></div>
          </section>
        </div>

        <section class="panel" id="audit" aria-labelledby="audit-title">
          <div class="panel-head">
            <span class="status-dot"></span>
            <h2 class="label" id="audit-title">Audit stream</h2>
            <span class="label stream-note" id="stream-note" aria-live="polite">· loading</span>
            <span class="audit-counts"><span class="allowed" id="c-allowed">0 allowed</span><span class="separator">·</span><span class="gated" id="c-gated">0 gated</span><span class="separator">·</span><span class="denied" id="c-denied">0 denied</span><span class="separator">·</span><span class="errors" id="c-errors">0 errors</span></span>
          </div>
          <div id="audit-content"><div class="empty">Loading recent entries…</div></div>
        </section>
      </div>

      <div class="privacy-note">Reads local Switchboard state only. Nothing here leaves your machine. Verify the complete chain with <code>switchboard audit verify</code>.</div>
    </main>
  </div>
</div>

<script>
  // Dynamic values always enter through textContent. Local state can never
  // become executable markup in this page.
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };

  const replaceChildrenOf = (id, ...nodes) => {
    document.getElementById(id).replaceChildren(...nodes);
  };

  const setText = (id, value) => {
    document.getElementById(id).textContent = String(value);
  };

  const emptyNote = (text) => el("div", "empty", text);

  const timeOf = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleTimeString();
  };

  const expiresIn = (iso) => {
    const remaining = new Date(iso).getTime() - Date.now();
    if (Number.isNaN(remaining)) return "expiry unavailable";
    if (remaining <= 0) return "expired";
    const minutes = Math.round(remaining / 60000);
    return minutes >= 90 ? "expires in " + (minutes / 60).toFixed(1) + "h" : "expires in " + minutes + "m";
  };

  const leasePercent = (pass) => {
    const start = new Date(pass.leaseStartedAt || pass.createdAt).getTime();
    const end = new Date(pass.expiresAt).getTime();
    const duration = end - start;
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round(((end - Date.now()) / duration) * 100)));
  };

  const stateBadge = (kind, label) => {
    const glyphs = { allowed: "●", gated: "▲", denied: "✕", cancelled: "○", error: "!" };
    const badge = el("span", "state state-" + kind);
    const glyph = el("span", "state-glyph", glyphs[kind]);
    glyph.setAttribute("aria-hidden", "true");
    badge.append(glyph, label || kind);
    return badge;
  };

  const policyRow = (tool, kind, label) => {
    const row = el("div", "policy-row");
    row.append(el("span", "policy-tool" + (kind === "denied" ? " muted" : ""), tool), stateBadge(kind, label));
    return row;
  };

  function passNode(pass) {
    const node = el("article", "pass");
    const title = el("div", "pass-title");
    title.append(el("span", "label", "pass"), el("span", "pass-id", pass.id), el("span", "pass-branch", "· " + pass.branch));
    node.append(title);

    node.append(el("div", "pass-meta", "acting as " + pass.agentRole + " · " + pass.profiles.join(", ") + " · " + (pass.repoName || pass.repoPath)));

    const policyHead = el("div", "policy-head");
    policyHead.append(el("span", "label", "tool surface"), el("span", "label", "configured policy"));
    node.append(policyHead);

    const allowed = pass.allowedTools.length ? pass.allowedTools : ["everything in scope"];
    allowed.forEach((tool) => node.append(policyRow(tool, "allowed", "in scope")));
    (pass.approvalGates || []).forEach((gate) => node.append(policyRow(gate.toolPattern, "gated", "gate")));
    pass.deniedTools.forEach((tool) => node.append(policyRow(tool, "denied", "deny")));

    const percent = leasePercent(pass);
    const lease = el("div", "lease");
    lease.dataset.leaseStartedAt = pass.leaseStartedAt || pass.createdAt;
    lease.dataset.expiresAt = pass.expiresAt;
    const leaseMeta = el("div", "lease-meta");
    const gateLabel = pass.approvalGateCount + " approval gate" + (pass.approvalGateCount === 1 ? "" : "s");
    leaseMeta.append(el("span", "", "lease · " + gateLabel), el("span", "lease-expiry", expiresIn(pass.expiresAt)));
    const track = el("div", "lease-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", "Pass lease remaining");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(percent));
    const fill = el("div", "lease-fill");
    fill.style.width = percent + "%";
    track.append(fill);
    lease.append(leaseMeta, track);
    node.append(lease);
    return node;
  }

  function refreshLeaseDisplays() {
    document.querySelectorAll(".lease").forEach((lease) => {
      const pass = {
        leaseStartedAt: lease.dataset.leaseStartedAt,
        expiresAt: lease.dataset.expiresAt
      };
      const percent = leasePercent(pass);
      lease.querySelector(".lease-expiry").textContent = expiresIn(pass.expiresAt);
      lease.querySelector(".lease-track").setAttribute("aria-valuenow", String(percent));
      lease.querySelector(".lease-fill").style.width = percent + "%";
    });
  }

  function approvalNode(approval) {
    const node = el("article", "approval");
    const title = el("div", "approval-title");
    title.append(stateBadge("gated", "held"), el("span", "approval-tool", approval.toolName));
    node.append(title);
    node.append(el("div", "approval-meta", "pass " + approval.mandateId + " · gate " + approval.approvalGateId + " (" + approval.approvalGatePattern + ") · waiting on a human"));
    const command = el("div", "approval-command");
    command.append("switchboard approve ", el("strong", "", approval.id));
    node.append(command);
    return node;
  }

  const auditKind = (entry) => {
    if (entry.dashboardOutcome) return entry.dashboardOutcome;
    if (entry.approvalDecision === "denied" || entry.approvalDecision === "declined") return "denied";
    if (entry.approvalDecision === "cancelled") return "cancelled";
    if (entry.approvalDecision === "failed") return "error";
    if (entry.status === "ok") return "allowed";
    const reason = String(entry.error || "").toLowerCase();
    if (entry.approvalGateId && reason.includes("denied")) return "denied";
    if (entry.approvalGateId) return "gated";
    if (reason.includes("denied") || reason.includes("out of scope") || reason.includes("no active pass") || reason.includes("strict mode")) return "denied";
    return "error";
  };

  const auditCell = (className, label) => {
    const cell = el("td", className);
    cell.append(el("span", "mobile-label", label));
    return cell;
  };

  function auditRow(entry) {
    const row = el("tr");
    const time = auditCell("audit-time", "Time");
    time.append(timeOf(entry.timestamp));
    const kind = auditKind(entry);
    const state = auditCell("audit-state", "State");
    state.append(stateBadge(kind));
    const action = auditCell("audit-action", "Action");
    action.append(entry.action);
    const detail = auditCell("audit-detail", "Tool and context");
    detail.append(el("span", "audit-tool", entry.toolName || entry.command || entry.profileName || entry.action));
    if (entry.mandateId) detail.append(" ", el("span", "audit-pass", "pass:" + entry.mandateId));
    if (entry.status !== "ok" && entry.error) detail.append(el("div", "audit-reason", entry.error));
    row.append(time, state, action, detail);
    return row;
  }

  let currentState = null;

  const auditSearchText = (entry) => [
    entry.action,
    entry.dashboardOutcome,
    entry.status,
    entry.toolName,
    entry.command,
    entry.profileName,
    entry.mandateId,
    entry.error
  ].filter(Boolean).join(" ").toLowerCase();

  function renderAudit() {
    if (!currentState) return;
    if (currentState.sourceHealth.audit === "error") {
      setText("stream-note", "· unavailable");
      replaceChildrenOf("audit-content", emptyNote("The audit store could not be read. Run switchboard doctor before relying on this view."));
      return;
    }
    const query = document.getElementById("audit-filter").value.trim().toLowerCase();
    const matches = currentState.audit.filter((entry) => !query || auditSearchText(entry).includes(query));
    const entries = matches.slice(0, 80);
    setText("stream-note", query
      ? "· " + (matches.length > entries.length ? "showing " + entries.length + " of " : "") + matches.length + " matches"
      : currentState.audit.length ? "· " + currentState.audit.length + " recent entries" : "· waiting");
    if (!entries.length) {
      replaceChildrenOf("audit-content", emptyNote(query ? "No recent entries match “" + query + "”." : "No audit entries yet. Routed calls appear here when a pass is live."));
      return;
    }

    const scroll = el("div", "audit-scroll");
    scroll.tabIndex = 0;
    scroll.setAttribute("aria-label", "Recent audit entries");
    const table = el("table");
    const caption = el("caption", "sr-only", "Recent local Switchboard audit entries");
    const head = el("thead");
    const headRow = el("tr");
    ["Time", "State", "Action", "Tool and context"].forEach((label) => {
      const th = el("th", "", label);
      th.scope = "col";
      headRow.append(th);
    });
    head.append(headRow);
    const body = el("tbody");
    entries.forEach((entry) => body.append(auditRow(entry)));
    table.append(caption, head, body);
    scroll.append(table);
    replaceChildrenOf("audit-content", scroll);
  }

  function renderState(state) {
    currentState = state;
    const passCount = state.counts.activePasses;
    const pendingCount = state.counts.pendingApprovals;
    setText("nav-passes", passCount);
    setText("nav-approvals", pendingCount);
    setText("pass-count", passCount + " active");
    setText("approval-count", pendingCount + " waiting");
    setText("c-allowed", state.counts.allowedCalls + " allowed");
    setText("c-gated", state.counts.gatedCalls + " gated");
    setText("c-denied", state.counts.deniedCalls + " denied");
    setText("c-errors", state.counts.errorCalls + " errors");

    document.getElementById("nav-approvals").classList.toggle("pending", pendingCount > 0);
    document.getElementById("approval-count").classList.toggle("pending", pendingCount > 0);
    document.getElementById("approval-dot").style.background = pendingCount > 0 ? "var(--gate)" : "var(--ink-faint)";

    const modeLabel = document.getElementById("mode-label");
    modeLabel.textContent = state.mode;
    modeLabel.className = "mode " + state.mode;

    const enforcementLabel = document.getElementById("enforcement-label");
    enforcementLabel.textContent = (state.enforcementRepoName || "launch repo") + " · " + state.repoEnforcement;
    enforcementLabel.className = "enforcement " + state.repoEnforcement;

    const failedSources = Object.entries(state.sourceHealth)
      .filter(([, status]) => status === "error")
      .map(([source]) => source);
    const healthNote = document.getElementById("health-note");
    healthNote.hidden = failedSources.length === 0;
    healthNote.textContent = failedSources.length
      ? "Some local state could not be read (" + failedSources.join(", ") + "). This dashboard may be incomplete. Run switchboard doctor."
      : "";

    replaceChildrenOf("passes-content", ...(state.passes.length
      ? state.passes.map(passNode)
      : [emptyNote(state.sourceHealth.mandates === "error"
        ? "The pass store could not be read. Run switchboard doctor before relying on this view."
        : state.repoEnforcement === "strict"
        ? "No live passes on this machine. The launch repo is strict, so its routed calls remain denied until you run: switchboard grant"
        : "No live passes on this machine. Give one out with: switchboard grant")]));

    replaceChildrenOf("approvals-content", ...(state.pendingApprovals.length
      ? state.pendingApprovals.map(approvalNode)
      : [emptyNote(state.sourceHealth.approvals === "error"
        ? "The approval store could not be read. Run switchboard doctor before relying on this view."
        : "Nothing waiting on you.")]));

    renderAudit();
    refreshLeaseDisplays();
  }

  let lastSignature = "";
  let refreshTimer;
  let refreshInFlight = false;

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    if (!document.hidden) refreshTimer = window.setTimeout(() => void refresh(), 2000);
  }

  async function refresh() {
    if (document.hidden || refreshInFlight) return;
    refreshInFlight = true;
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) throw new Error("state request failed");
      const state = await response.json();
      const signature = JSON.stringify({ mode: state.mode, repoEnforcement: state.repoEnforcement, enforcementRepoPath: state.enforcementRepoPath, sourceHealth: state.sourceHealth, passes: state.passes, pendingApprovals: state.pendingApprovals, audit: state.audit, counts: state.counts });
      if (signature !== lastSignature) {
        lastSignature = signature;
        renderState(state);
      }
      refreshLeaseDisplays();
    } catch {
      lastSignature = "";
      const modeLabel = document.getElementById("mode-label");
      modeLabel.textContent = "disconnected";
      modeLabel.className = "mode degraded";
      setText("stream-note", "· disconnected");
      const healthNote = document.getElementById("health-note");
      healthNote.hidden = false;
      healthNote.textContent = "The dashboard cannot reach its local state endpoint. Existing data may be stale.";
    } finally {
      refreshInFlight = false;
      scheduleRefresh();
    }
  }

  document.getElementById("local-address").textContent = location.host;
  document.getElementById("audit-filter").addEventListener("input", renderAudit);
  document.getElementById("filter-toggle").addEventListener("click", () => {
    const row = document.getElementById("filter-row");
    const open = row.hidden;
    row.hidden = !open;
    document.getElementById("filter-toggle").setAttribute("aria-expanded", String(open));
    if (open) document.getElementById("audit-filter").focus();
  });
  document.getElementById("audit-filter").addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.getElementById("filter-row").hidden = true;
    document.getElementById("filter-toggle").setAttribute("aria-expanded", "false");
    document.getElementById("filter-toggle").focus();
  });
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll("[data-nav]").forEach((item) => {
        const active = item === link;
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      });
    });
  });
  document.addEventListener("visibilitychange", () => {
    window.clearTimeout(refreshTimer);
    if (!document.hidden) void refresh();
  });
  void refresh();
</script>
</body>
</html>`;
}
