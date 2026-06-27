import type {
  BypassFinding,
  CommandShape,
  RiskFinding
} from "../import/import-plan.js";
import type { RecommendedNextAction } from "../next-actions/next-actions.js";

export type AuthorityControlStatus =
  | "controlled"
  | "partial-control"
  | "bypass-present"
  | "invalid";

export interface AuthorityStatus {
  status: AuthorityControlStatus;
  summary: string;
  blockers: string[];
  findings: string[];
  recommendedAction: CommandShape | null;
}

export interface PlanAuthorityStatusOptions {
  diagnostics?: Array<{ level: string }>;
  invalidClientConfigs?: boolean;
  bypassFindings?: BypassFinding[];
  riskFindings?: RiskFinding[];
  missingSecrets?: Array<unknown>;
  switchboardConfigured?: boolean;
  switchboardInstalled?: boolean;
  recommendedNextAction?: RecommendedNextAction;
}

export function planAuthorityStatus(
  options: PlanAuthorityStatusOptions
): AuthorityStatus {
  const diagnosticsInvalid =
    options.diagnostics?.some((diagnostic) => diagnostic.level === "error") ??
    false;
  if (diagnosticsInvalid || options.invalidClientConfigs) {
    return {
      status: "invalid",
      summary:
        "Switchboard cannot assess authority until config parsing errors are fixed.",
      blockers: [
        ...(diagnosticsInvalid ? ["switchboard-config-invalid"] : []),
        ...(options.invalidClientConfigs ? ["client-config-invalid"] : [])
      ],
      findings: [],
      recommendedAction: recommendedActionCommand(options)
    };
  }

  const bypassFindings = options.bypassFindings ?? [];
  const unacceptedBypasses = bypassFindings.filter(
    (finding) => finding.status !== "accepted"
  );
  const acceptedBypasses = bypassFindings.filter(
    (finding) => finding.status === "accepted"
  );
  const highRiskFindings = (options.riskFindings ?? []).filter(
    (finding) => finding.severity === "high" || finding.severity === "critical"
  );

  if (unacceptedBypasses.length > 0 || highRiskFindings.length > 0) {
    return {
      status: "bypass-present",
      summary:
        "Direct or high-risk tool access can bypass Switchboard authority.",
      blockers: [
        ...unacceptedBypasses.map((finding) => finding.id),
        ...highRiskFindings.map((finding) => finding.id)
      ],
      findings: [
        ...bypassFindings.map((finding) => finding.id),
        ...(options.riskFindings ?? []).map((finding) => finding.id)
      ],
      recommendedAction:
        unacceptedBypasses.length > 0
          ? {
              command: "switchboard",
              args: ["import", "--write", "--cleanup-client"]
            }
          : recommendedActionCommand(options)
    };
  }

  if (
    acceptedBypasses.length > 0 ||
    (options.riskFindings ?? []).length > 0 ||
    (options.missingSecrets?.length ?? 0) > 0 ||
    !options.switchboardConfigured ||
    !options.switchboardInstalled
  ) {
    return {
      status: "partial-control",
      summary:
        "Switchboard has some authority for this repo, but setup or accepted risk remains.",
      blockers: [],
      findings: [
        ...bypassFindings.map((finding) => finding.id),
        ...(options.riskFindings ?? []).map((finding) => finding.id)
      ],
      recommendedAction: recommendedActionCommand(options)
    };
  }

  return {
    status: "controlled",
    summary:
      "Switchboard appears to be the active project authority route for detected agent tools.",
    blockers: [],
    findings: [],
    recommendedAction: recommendedActionCommand(options)
  };
}

function recommendedActionCommand(
  options: PlanAuthorityStatusOptions
): CommandShape | null {
  const command = options.recommendedNextAction?.primary?.command;
  if (!command) {
    return null;
  }

  return command.startsWith("switchboard ")
    ? {
        command: "switchboard",
        args: command.slice("switchboard ".length).split(" ").filter(Boolean)
      }
    : { command, args: [] };
}
