export type RecommendedNextActionKind =
  | "invalid-config"
  | "missing-secret"
  | "bypass-cleanup"
  | "provider-setup"
  | "client-install"
  | "mandate-create"
  | "launch"
  | "report"
  | "info";

export interface NextActionCandidate {
  kind: RecommendedNextActionKind;
  command: string;
  reason: string;
}

export interface RecommendedNextAction {
  primary: NextActionCandidate | null;
  alternatives: NextActionCandidate[];
}

const nextActionRank: Record<RecommendedNextActionKind, number> = {
  "invalid-config": 10,
  "bypass-cleanup": 20,
  "missing-secret": 30,
  "provider-setup": 35,
  "client-install": 40,
  "mandate-create": 50,
  launch: 60,
  report: 70,
  info: 80
};

export function planRecommendedNextAction(
  candidates: NextActionCandidate[]
): RecommendedNextAction {
  const unique = uniqueCandidates(candidates);
  const sorted = unique.sort((a, b) => {
    const rankDelta = nextActionRank[a.kind] - nextActionRank[b.kind];
    return rankDelta === 0 ? a.command.localeCompare(b.command) : rankDelta;
  });
  const [primary, ...alternatives] = sorted;

  return {
    primary: primary ?? null,
    alternatives
  };
}

function uniqueCandidates(
  candidates: NextActionCandidate[]
): NextActionCandidate[] {
  const seen = new Set<string>();
  const unique: NextActionCandidate[] = [];

  for (const candidate of candidates) {
    const command = candidate.command.trim();
    if (command.length === 0) {
      continue;
    }
    if (seen.has(command)) {
      continue;
    }
    seen.add(command);
    unique.push({ ...candidate, command });
  }

  return unique;
}
