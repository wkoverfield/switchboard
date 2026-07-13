import { createServer, type Server } from "node:http";
import {
  listApprovalRequests,
  listMandates,
  readAuditLogEntries,
  resolveApprovalRequestStorePath,
  resolveAuditLogPath,
  resolveMandateStorePath,
  type AuditLogEntry
} from "@switchboard-mcp/core";

export const dashboardStateSchemaVersion = "switchboard.dashboard-state.v1";

export interface DashboardOptions {
  port?: number;
  host?: string;
  auditLogPath?: string;
  mandateStorePath?: string;
  approvalStorePath?: string;
  auditLimit?: number;
}

export interface DashboardHandle {
  server: Server;
  url: string;
  port: number;
  close(): Promise<void>;
}

interface DashboardPass {
  id: string;
  branch: string;
  repoPath: string;
  agentRole: string;
  profiles: string[];
  runtimeStatus: string;
  expiresAt: string;
  lease: string;
  allowedTools: string[];
  deniedTools: string[];
  approvalGateCount: number;
}

interface DashboardState {
  ok: true;
  schemaVersion: typeof dashboardStateSchemaVersion;
  generatedAt: string;
  passes: DashboardPass[];
  pendingApprovals: Array<{
    id: string;
    toolName: string;
    mandateId: string;
    repoPath: string;
    createdAt: string;
  }>;
  audit: AuditLogEntry[];
  counts: {
    activePasses: number;
    pendingApprovals: number;
    allowedCalls: number;
    deniedCalls: number;
  };
}

export async function collectDashboardState(
  options: DashboardOptions = {}
): Promise<DashboardState> {
  const auditLogPath = options.auditLogPath ?? resolveAuditLogPath();
  const mandateStorePath = options.mandateStorePath ?? resolveMandateStorePath();
  const approvalStorePath =
    options.approvalStorePath ?? resolveApprovalRequestStorePath();
  const auditLimit = options.auditLimit ?? 200;

  const [mandates, approvals, audit] = await Promise.all([
    listMandates({ path: mandateStorePath }).catch(() => []),
    listApprovalRequests({ path: approvalStorePath }).catch(() => []),
    readAuditLogEntries({ path: auditLogPath, limit: auditLimit }).catch(
      () => [] as AuditLogEntry[]
    )
  ]);

  const passes: DashboardPass[] = mandates
    .filter((mandate) => mandate.runtimeStatus === "active")
    .map((mandate) => ({
      id: mandate.id,
      branch: mandate.branch,
      repoPath: mandate.repoPath,
      agentRole: mandate.agentRole,
      profiles: mandate.profiles,
      runtimeStatus: mandate.runtimeStatus,
      expiresAt: mandate.expiresAt,
      lease: mandate.lease,
      allowedTools: mandate.allowedTools,
      deniedTools: mandate.deniedTools,
      approvalGateCount: mandate.approvalGates?.length ?? 0
    }));

  const pendingApprovals = approvals
    .filter((request) => request.runtimeStatus === "pending")
    .map((request) => ({
      id: request.id,
      toolName: request.toolName,
      mandateId: request.mandateId,
      repoPath: request.repoPath,
      createdAt: request.createdAt
    }));

  const toolCalls = audit.filter((entry) => entry.action === "tool_call");

  return {
    ok: true,
    schemaVersion: dashboardStateSchemaVersion,
    generatedAt: new Date().toISOString(),
    passes,
    pendingApprovals,
    audit: [...audit].reverse(),
    counts: {
      activePasses: passes.length,
      pendingApprovals: pendingApprovals.length,
      allowedCalls: toolCalls.filter((entry) => entry.status === "ok").length,
      deniedCalls: toolCalls.filter((entry) => entry.status === "error").length
    }
  };
}

export async function startDashboard(
  options: DashboardOptions = {}
): Promise<DashboardHandle> {
  // Local-only by design: the dashboard is a read-only window over local
  // state files and must never listen on a routable interface.
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 7878;

  const server = createServer((request, response) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`
    );

    if (url.pathname === "/api/state") {
      void collectDashboardState(options)
        .then((state) => {
          response.writeHead(200, {
            "content-type": "application/json",
            "cache-control": "no-store"
          });
          response.end(JSON.stringify(state));
        })
        .catch((error: unknown) => {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : "unknown error"
            })
          );
        });
      return;
    }

    if (url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(dashboardHtml());
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(requestedPort, host, () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  const port =
    typeof address === "object" && address !== null
      ? address.port
      : requestedPort;

  return {
    server,
    port,
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      })
  };
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Switchboard</title>
<style>
  :root {
    --bg: #0b0e12;
    --panel: #11161d;
    --line: #1e2630;
    --text: #d7dee8;
    --dim: #7d8a99;
    --green: #3fd68f;
    --red: #ff5f6d;
    --yellow: #f2c94c;
    font-size: 15px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 14px;
    padding: 18px 22px 10px;
    border-bottom: 1px solid var(--line);
    flex-wrap: wrap;
  }
  header h1 { font-size: 1.05rem; margin: 0; letter-spacing: 0.04em; }
  header .sub { color: var(--dim); font-size: 0.8rem; }
  .pills { margin-left: auto; display: flex; gap: 10px; }
  .pill {
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 12px;
    font-size: 0.78rem;
    color: var(--dim);
  }
  .pill b { color: var(--text); font-weight: 600; }
  .pill.denied b { color: var(--red); }
  .pill.allowed b { color: var(--green); }
  .pill.pending b { color: var(--yellow); }
  main {
    display: grid;
    grid-template-columns: minmax(300px, 380px) 1fr;
    gap: 16px;
    padding: 16px 22px 30px;
    align-items: start;
  }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
  section {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
  }
  section h2 {
    margin: 0;
    padding: 10px 14px;
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--dim);
    border-bottom: 1px solid var(--line);
  }
  .empty { padding: 16px 14px; color: var(--dim); font-size: 0.82rem; }
  .pass { padding: 12px 14px; border-bottom: 1px solid var(--line); }
  .pass:last-child { border-bottom: none; }
  .pass .id { color: var(--green); font-weight: 600; }
  .pass .meta { color: var(--dim); font-size: 0.78rem; margin-top: 3px; }
  .pass .scope { font-size: 0.78rem; margin-top: 6px; }
  .allow { color: var(--green); }
  .deny { color: var(--red); }
  .approval { padding: 10px 14px; border-bottom: 1px solid var(--line); font-size: 0.82rem; }
  .approval:last-child { border-bottom: none; }
  .approval .tool { color: var(--yellow); }
  .approval .hint { color: var(--dim); font-size: 0.75rem; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
    white-space: nowrap;
  }
  td.what { white-space: normal; word-break: break-word; }
  tr:last-child td { border-bottom: none; }
  .t { color: var(--dim); font-size: 0.72rem; }
  .ok { color: var(--green); }
  .err { color: var(--red); }
  .gate { color: var(--yellow); }
  .reason { color: var(--dim); }
  .stack { display: flex; flex-direction: column; gap: 16px; }
  footer { padding: 0 22px 20px; color: var(--dim); font-size: 0.72rem; }
</style>
</head>
<body>
<header>
  <h1>SWITCHBOARD</h1>
  <span class="sub">local dashboard &middot; read-only &middot; 127.0.0.1</span>
  <div class="pills">
    <span class="pill">passes <b id="c-passes">&ndash;</b></span>
    <span class="pill pending">pending approvals <b id="c-pending">&ndash;</b></span>
    <span class="pill allowed">allowed <b id="c-allowed">&ndash;</b></span>
    <span class="pill denied">denied <b id="c-denied">&ndash;</b></span>
  </div>
</header>
<main>
  <div class="stack">
    <section>
      <h2>Live passes</h2>
      <div id="passes"><div class="empty">loading&hellip;</div></div>
    </section>
    <section>
      <h2>Pending approvals</h2>
      <div id="approvals"><div class="empty">loading&hellip;</div></div>
    </section>
  </div>
  <section>
    <h2>Audit stream <span id="stream-note"></span></h2>
    <div id="audit"><div class="empty">loading&hellip;</div></div>
  </section>
</main>
<footer>
  Reads local Switchboard state only. Nothing here leaves your machine.
  Verify the log chain with <code>switchboard audit verify</code>.
</footer>
<script>
  // All rendering uses document.createElement/textContent, never markup
  // strings, so log/store contents can never execute in this page.
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const replaceChildrenOf = (id, ...nodes) => {
    document.getElementById(id).replaceChildren(...nodes);
  };

  const emptyNote = (text) => el("div", "empty", text);

  const timeOf = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString();
  };

  const expiresIn = (iso) => {
    const ms = new Date(iso).getTime() - Date.now();
    if (Number.isNaN(ms)) return "";
    if (ms <= 0) return "expired";
    const m = Math.round(ms / 60000);
    return m >= 90 ? "expires in " + (m / 60).toFixed(1) + "h" : "expires in " + m + "m";
  };

  function passNode(p) {
    const node = el("div", "pass");
    const title = el("div");
    title.append(el("span", "id", p.id), " · " + p.branch);
    node.append(title);
    node.append(el("div", "meta",
      "acting as " + p.agentRole + " · " + p.profiles.join(", ") +
      " · " + expiresIn(p.expiresAt)));
    const scope = el("div", "scope");
    scope.append(el("span", "allow", "allow "),
      p.allowedTools.length ? p.allowedTools.join(", ") : "everything in scope");
    if (p.deniedTools.length) {
      scope.append(el("br"), el("span", "deny", "deny "), p.deniedTools.join(", "));
    }
    if (p.approvalGateCount) {
      scope.append(el("br"), el("span", "gate", p.approvalGateCount + " approval gate(s)"));
    }
    node.append(scope);
    return node;
  }

  function approvalNode(a) {
    const node = el("div", "approval");
    node.append(el("span", "tool", a.toolName), " · pass " + a.mandateId);
    node.append(el("div", "hint", "decide with: switchboard approve " + a.id));
    return node;
  }

  function auditRow(e) {
    const row = el("tr");
    row.append(el("td", "t", timeOf(e.timestamp)));
    const denied = e.status !== "ok";
    const gated = denied && e.approvalGateId;
    row.append(el("td", gated ? "gate" : denied ? "err" : "ok",
      gated ? "gated" : denied ? "denied" : "ok"));
    row.append(el("td", "t", e.action));
    const what = el("td", "what");
    what.append(String(e.toolName || e.command || e.profileName || e.action));
    if (e.mandateId) what.append(" ", el("span", "t", "pass:" + e.mandateId));
    if (denied && e.error) what.append(el("div", "reason", e.error));
    row.append(what);
    return row;
  }

  async function tick() {
    try {
      const res = await fetch("/api/state");
      const state = await res.json();
      for (const [id, value] of [
        ["c-passes", state.counts.activePasses],
        ["c-pending", state.counts.pendingApprovals],
        ["c-allowed", state.counts.allowedCalls],
        ["c-denied", state.counts.deniedCalls]
      ]) {
        document.getElementById(id).textContent = String(value);
      }
      replaceChildrenOf("passes", ...(state.passes.length
        ? state.passes.map(passNode)
        : [emptyNote("No live passes. Give one out with: switchboard grant")]));
      replaceChildrenOf("approvals", ...(state.pendingApprovals.length
        ? state.pendingApprovals.map(approvalNode)
        : [emptyNote("Nothing waiting on you.")]));
      if (state.audit.length) {
        const table = el("table");
        state.audit.slice(0, 80).forEach((entry) => table.append(auditRow(entry)));
        replaceChildrenOf("audit", table);
      } else {
        replaceChildrenOf("audit", emptyNote("No audit entries yet."));
      }
      document.getElementById("stream-note").textContent =
        " · " + state.audit.length + " recent entries";
    } catch {
      document.getElementById("stream-note").textContent = " · disconnected";
    }
  }

  tick();
  setInterval(tick, 2000);
</script>
</body>
</html>`;
}
