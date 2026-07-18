import type { AuditLogEntry } from "../audit/audit-log.js";
import type { MandateWithStatus } from "../mandates/mandates.js";

/**
 * The delegation tree of a wave: which mandate spawned which, the tool calls
 * each actor made, and what each was denied. Built purely from the mandate
 * store (parentage, lease status) and the audit log (calls, denials), so it
 * reconstructs a completed wave after the fact with no live daemon.
 *
 * Calls are correlated to a mandate by its `mandateUid` when present (unique
 * per spawn, so two same-named mandates across time never collide), falling
 * back to `mandateId` for legacy entries that predate the uid.
 */

export interface FleetCallSummary {
  toolName: string;
  ok: number;
  denied: number;
  /** Distinct denial reasons, for the "what was refused" column. */
  reasons: string[];
}

export interface FleetNode {
  mandateId: string;
  mandateUid: string | null;
  agentRole: string;
  runtimeStatus: MandateWithStatus["runtimeStatus"];
  parentMandateId: string | null;
  depth: number;
  calls: FleetCallSummary[];
  totals: { calls: number; ok: number; denied: number };
  children: FleetNode[];
}

export interface FleetReport {
  generatedAt: string;
  repoPath: string | null;
  roots: FleetNode[];
  totals: { mandates: number; calls: number; ok: number; denied: number };
}

export interface BuildFleetReportOptions {
  mandates: MandateWithStatus[];
  auditEntries: AuditLogEntry[];
  repoPath?: string | undefined;
  now?: () => Date;
}

function mandateKey(
  mandate: Pick<MandateWithStatus, "id" | "mandateUid">
): string {
  return mandate.mandateUid ?? `id:${mandate.id}`;
}

function entryKey(entry: AuditLogEntry): string | null {
  if (entry.mandateUid) {
    return entry.mandateUid;
  }
  if (entry.mandateId) {
    return `id:${entry.mandateId}`;
  }
  return null;
}

function summarizeCalls(entries: AuditLogEntry[]): {
  calls: FleetCallSummary[];
  totals: { calls: number; ok: number; denied: number };
} {
  const byTool = new Map<string, FleetCallSummary>();
  let ok = 0;
  let denied = 0;

  for (const entry of entries) {
    if (entry.action !== "tool_call" && entry.action !== "hook_denial") {
      continue;
    }
    const toolName = entry.toolName ?? entry.command ?? "(unknown)";
    let summary = byTool.get(toolName);
    if (!summary) {
      summary = { toolName, ok: 0, denied: 0, reasons: [] };
      byTool.set(toolName, summary);
    }
    if (entry.status === "ok") {
      summary.ok += 1;
      ok += 1;
    } else {
      summary.denied += 1;
      denied += 1;
      if (entry.error && !summary.reasons.includes(entry.error)) {
        summary.reasons.push(entry.error);
      }
    }
  }

  const calls = [...byTool.values()].sort((a, b) =>
    a.toolName.localeCompare(b.toolName)
  );
  return { calls, totals: { calls: ok + denied, ok, denied } };
}

export function buildFleetReport(
  options: BuildFleetReportOptions
): FleetReport {
  const now = options.now?.() ?? new Date();
  const repoPath = options.repoPath ?? null;

  const entriesByKey = new Map<string, AuditLogEntry[]>();
  for (const entry of options.auditEntries) {
    const key = entryKey(entry);
    if (key === null) {
      continue;
    }
    const list = entriesByKey.get(key) ?? [];
    list.push(entry);
    entriesByKey.set(key, list);
  }

  const nodesByKey = new Map<string, FleetNode>();
  const nodesById = new Map<string, FleetNode>();
  const allNodes: FleetNode[] = [];
  for (const mandate of options.mandates) {
    const key = mandateKey(mandate);
    const { calls, totals } = summarizeCalls(entriesByKey.get(key) ?? []);
    const node: FleetNode = {
      mandateId: mandate.id,
      mandateUid: mandate.mandateUid ?? null,
      agentRole: mandate.agentRole,
      runtimeStatus: mandate.runtimeStatus,
      parentMandateId: mandate.parentMandateId ?? null,
      depth: 0,
      calls,
      totals,
      children: []
    };
    allNodes.push(node);
    nodesByKey.set(key, node);
    if (mandate.mandateUid) {
      nodesByKey.set(mandate.mandateUid, node);
    }
    // First mandate for an id wins as the id-fallback parent target.
    if (!nodesById.has(mandate.id)) {
      nodesById.set(mandate.id, node);
    }
  }

  const roots: FleetNode[] = [];
  for (const mandate of options.mandates) {
    const node = nodesByKey.get(mandateKey(mandate));
    if (!node) {
      continue;
    }
    const parent =
      (mandate.parentMandateUid
        ? nodesByKey.get(mandate.parentMandateUid)
        : undefined) ??
      (mandate.parentMandateId
        ? nodesById.get(mandate.parentMandateId)
        : undefined);
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const assignDepth = (node: FleetNode, depth: number): void => {
    node.depth = depth;
    for (const child of node.children) {
      assignDepth(child, depth + 1);
    }
  };
  for (const root of roots) {
    assignDepth(root, 0);
  }

  let calls = 0;
  let ok = 0;
  let denied = 0;
  for (const node of allNodes) {
    calls += node.totals.calls;
    ok += node.totals.ok;
    denied += node.totals.denied;
  }

  return {
    generatedAt: now.toISOString(),
    repoPath,
    roots,
    totals: {
      mandates: allNodes.length,
      calls,
      ok,
      denied
    }
  };
}

export function renderFleetReport(report: FleetReport): string {
  const lines: string[] = [];
  lines.push(
    report.repoPath
      ? `Delegation tree: ${report.repoPath}`
      : "Delegation tree"
  );
  lines.push(
    `${report.totals.mandates} mandate(s), ${report.totals.calls} call(s): ${report.totals.ok} ok, ${report.totals.denied} denied`
  );
  lines.push("");

  if (report.roots.length === 0) {
    lines.push("No mandates found for this repo.");
    return lines.join("\n");
  }

  const renderNode = (node: FleetNode, prefix: string, isLast: boolean, isRoot: boolean): void => {
    const connector = isRoot ? "" : isLast ? "└─ " : "├─ ";
    const parentSuffix = node.parentMandateId
      ? `  (parent: ${node.parentMandateId})`
      : "";
    lines.push(
      `${prefix}${connector}● ${node.mandateId}  [${node.agentRole}, ${node.runtimeStatus}]${parentSuffix}`
    );

    const childPrefix = isRoot
      ? prefix
      : `${prefix}${isLast ? "   " : "│  "}`;
    const detailPrefix = `${childPrefix}${node.children.length > 0 ? "│  " : "   "}`;

    if (node.calls.length === 0) {
      lines.push(`${detailPrefix}(no recorded tool calls)`);
    } else {
      for (const call of node.calls) {
        const parts: string[] = [];
        if (call.ok > 0) {
          parts.push(`${call.ok} ok`);
        }
        if (call.denied > 0) {
          parts.push(`${call.denied} DENIED`);
        }
        const reason =
          call.reasons.length > 0 ? ` (${call.reasons[0]})` : "";
        lines.push(`${detailPrefix}${call.toolName}: ${parts.join(", ")}${reason}`);
      }
    }

    node.children.forEach((child, index) => {
      renderNode(
        child,
        childPrefix,
        index === node.children.length - 1,
        false
      );
    });
  };

  report.roots.forEach((root) => {
    renderNode(root, "", true, true);
  });

  return lines.join("\n");
}
