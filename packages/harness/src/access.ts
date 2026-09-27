/** The only supported access mode for the harness. */
export const ACCESS = Object.freeze({
  id: "approval" as const,
  label: "Request approval",
  summary:
    "Require approval for detected risky actions, including external file edits and outbound network requests.",
  permissions: Object.freeze({
    workspaceFiles: "allowed",
    workspaceWrites: "risk-assessed",
    externalFiles: "approval-required",
    network: "approval-required",
    riskyOperations: "approval-required",
  }),
});

export type Access = typeof ACCESS;

export type RiskLevel = "none" | "low" | "medium" | "high";
export type RiskKind = "safe" | "workspace_file" | "workspace_write" | "external_file" | "network" | "shell";

export interface GateRequest {
  kind: RiskKind;
  riskLevel?: RiskLevel;
  description?: string;
  path?: string;
  isExternal?: boolean;
}

interface GateDecisionBase {
  mode: Access["id"];
  reason?: string;
}

export type GateDecision = GateDecisionBase &
  (
    | {
        proceed: true;
        asked: false;
        approvalRequired: false;
        riskLevel: "none" | "low";
      }
    | {
        proceed: false;
        asked: true;
        approvalRequired: true;
        riskLevel: "medium" | "high";
      }
  );

const RISK_LEVELS: Record<RiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const DEFAULT_RISK_LEVEL: Record<RiskKind, RiskLevel> = {
  safe: "none",
  workspace_file: "low",
  workspace_write: "low",
  external_file: "high",
  network: "medium",
  shell: "high",
};

export function access(): Access {
  return ACCESS;
}

export function gate(request: GateRequest = { kind: "safe" }): GateDecision {
  if (!Object.hasOwn(DEFAULT_RISK_LEVEL, request.kind)) {
    throw new TypeError(`Unknown risk kind "${String(request.kind)}".`);
  }
  if (
    request.riskLevel !== undefined &&
    !Object.hasOwn(RISK_LEVELS, request.riskLevel)
  ) {
    throw new TypeError(`Unknown risk level "${String(request.riskLevel)}".`);
  }

  const inferredRisk = request.isExternal ? "high" : DEFAULT_RISK_LEVEL[request.kind];
  const riskLevel =
    request.riskLevel && RISK_LEVELS[request.riskLevel] > RISK_LEVELS[inferredRisk]
      ? request.riskLevel
      : inferredRisk;
  const approvalRequired = RISK_LEVELS[riskLevel] >= RISK_LEVELS.medium;

  if (!approvalRequired) {
    return {
      proceed: true,
      asked: false,
      mode: ACCESS.id,
      approvalRequired: false,
      riskLevel,
      reason: request.description ?? "No risky action detected.",
    };
  }

  return {
    proceed: false,
    asked: true,
    mode: ACCESS.id,
    approvalRequired: true,
    riskLevel,
    reason: request.description ?? (
      request.kind === "external_file"
        ? "External file edits require explicit approval."
        : request.kind === "network"
          ? "Outbound network access requires explicit approval."
          : request.kind === "shell"
            ? "Risky shell or command execution requires explicit approval."
            : "This action was classified as risky and requires explicit approval."
    ),
  };
}
