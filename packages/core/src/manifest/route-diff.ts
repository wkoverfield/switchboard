export type SupportedRouteClient = "codex" | "claude";
export type ManifestRouteDiffStatus = "in-sync" | "drift" | "unknown";
export type ManifestRouteDiffSeverity = "info" | "warning" | "error";
export type ManifestRouteDiffFindingType =
  | "switchboard-route-missing"
  | "switchboard-route-stale"
  | "client-config-invalid"
  | "direct-route"
  | "accepted-direct-route"
  | "rendered-route-unavailable";

export interface ManifestRouteDiffFinding {
  type: ManifestRouteDiffFindingType;
  severity: ManifestRouteDiffSeverity;
  client: SupportedRouteClient;
  serverName?: string | undefined;
  message: string;
  resolveCommand: string | null;
}

export interface ManifestClientRouteDiff {
  client: SupportedRouteClient;
  status: ManifestRouteDiffStatus;
  findings: ManifestRouteDiffFinding[];
}

export interface ManifestRouteDiff {
  status: ManifestRouteDiffStatus;
  counts: {
    clients: number;
    inSync: number;
    drift: number;
    unknown: number;
    findings: number;
  };
  clients: ManifestClientRouteDiff[];
}

export interface DiffManifestClientRouteInput {
  client: SupportedRouteClient;
  status: string;
  directServerNames: string[];
  renderedAvailable: boolean;
}

export interface DiffManifestClientRoutesOptions {
  clients: DiffManifestClientRouteInput[];
  acceptedDirectRisks: Array<{ client: string; serverName: string }>;
  configValid: boolean;
}

export function diffManifestClientRoutes(
  options: DiffManifestClientRoutesOptions
): ManifestRouteDiff {
  const acceptedDirect = new Set(
    options.acceptedDirectRisks.map((risk) => `${risk.client}:${risk.serverName}`)
  );
  const clients = options.clients.map((client) =>
    diffClientRoutes(client, acceptedDirect, options.configValid)
  );

  const counts = {
    clients: clients.length,
    inSync: clients.filter((client) => client.status === "in-sync").length,
    drift: clients.filter((client) => client.status === "drift").length,
    unknown: clients.filter((client) => client.status === "unknown").length,
    findings: clients.reduce((total, client) => total + client.findings.length, 0)
  };

  return {
    status:
      counts.drift > 0 ? "drift" : counts.unknown > 0 ? "unknown" : "in-sync",
    counts,
    clients
  };
}

function diffClientRoutes(
  client: DiffManifestClientRouteInput,
  acceptedDirect: Set<string>,
  configValid: boolean
): ManifestClientRouteDiff {
  const findings: ManifestRouteDiffFinding[] = [];
  const renderedUnavailable = !configValid || !client.renderedAvailable;

  if (renderedUnavailable) {
    findings.push({
      type: "rendered-route-unavailable",
      severity: configValid ? "warning" : "error",
      client: client.client,
      message: configValid
        ? `the intended Switchboard ${client.client} route could not be rendered, so drift cannot be assessed`
        : `Switchboard config is invalid, so the intended ${client.client} route could not be rendered`,
      resolveCommand: configValid ? null : "switchboard doctor"
    });
  } else if (client.status === "missing") {
    findings.push({
      type: "switchboard-route-missing",
      severity: "warning",
      client: client.client,
      message: `${client.client} project config does not route through Switchboard yet`,
      resolveCommand: `switchboard install ${client.client} --write`
    });
  } else if (client.status === "stale") {
    findings.push({
      type: "switchboard-route-stale",
      severity: "warning",
      client: client.client,
      message: `${client.client} project config routes through Switchboard but no longer matches the intended rendered route`,
      resolveCommand: `switchboard install ${client.client} --write`
    });
  } else if (client.status === "invalid") {
    findings.push({
      type: "client-config-invalid",
      severity: "error",
      client: client.client,
      message: `${client.client} project config could not be parsed, so its routes cannot be trusted`,
      resolveCommand: "switchboard import --dry-run"
    });
  }

  for (const serverName of client.directServerNames) {
    const accepted = acceptedDirect.has(`${client.client}:${serverName}`);
    findings.push(
      accepted
        ? {
            type: "accepted-direct-route",
            severity: "info",
            client: client.client,
            serverName,
            message: `${client.client} routes "${serverName}" directly; this bypass is recorded as accepted risk`,
            resolveCommand: null
          }
        : {
            type: "direct-route",
            severity: "warning",
            client: client.client,
            serverName,
            message: `${client.client} routes "${serverName}" directly, bypassing Switchboard authority`,
            resolveCommand: `switchboard import --write --cleanup-client --accept-direct ${client.client}:${serverName}`
          }
    );
  }

  return {
    client: client.client,
    status: clientDiffStatus(findings),
    findings
  };
}

function clientDiffStatus(
  findings: ManifestRouteDiffFinding[]
): ManifestRouteDiffStatus {
  const definiteDrift = findings.some(
    (finding) =>
      finding.severity !== "info" &&
      finding.type !== "rendered-route-unavailable"
  );
  if (definiteDrift) {
    return "drift";
  }
  if (
    findings.some((finding) => finding.type === "rendered-route-unavailable")
  ) {
    return "unknown";
  }

  return "in-sync";
}
