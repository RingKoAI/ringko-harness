/** Permission modes the harness exposes. */
export type AccessMode = "approval" | "assist" | "full";

export interface AccessPermissions {
  workspaceFiles: "allowed" | "risk-assessed" | "approval-required";
  workspaceWrites: "allowed" | "risk-assessed" | "approval-required";
  externalFiles: "allowed" | "risk-assessed" | "approval-required";
  network: "allowed" | "risk-assessed" | "approval-required";
  riskyOperations: "allowed" | "risk-assessed" | "approval-required";
}

export interface Access {
  id: AccessMode;
  label: string;
  summary: string;
  permissions: AccessPermissions;
}

export const ACCESS_MODES: Record<AccessMode, Access> = Object.freeze({
  approval: Object.freeze({
    id: "approval" as const,
    label: "Request approval",
    summary: "Always ask when editing external files or using the internet.",
    permissions: Object.freeze({
      workspaceFiles: "allowed",
      workspaceWrites: "risk-assessed",
      externalFiles: "approval-required",
      network: "approval-required",
      riskyOperations: "approval-required",
    }),
  }),
  assist: Object.freeze({
    id: "assist" as const,
    label: "Approve risky actions",
    summary: "Only request approval for detected risky operations.",
    permissions: Object.freeze({
      workspaceFiles: "allowed",
      workspaceWrites: "risk-assessed",
      externalFiles: "risk-assessed",
      network: "risk-assessed",
      riskyOperations: "risk-assessed",
    }),
  }),
  full: Object.freeze({
    id: "full" as const,
    label: "Full access",
    summary: "Unrestricted access to the internet and any file on your computer.",
    permissions: Object.freeze({
      workspaceFiles: "allowed",
      workspaceWrites: "allowed",
      externalFiles: "allowed",
      network: "allowed",
      riskyOperations: "allowed",
    }),
  }),
});

/** Default access mode. */
export const DEFAULT_ACCESS_MODE: AccessMode = "approval";

/** The default access mode (kept for callers that only need the mode object). */
export const ACCESS = ACCESS_MODES[DEFAULT_ACCESS_MODE];

export function isAccessMode(value: unknown): value is AccessMode {
  return value === "approval" || value === "assist" || value === "full";
}

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
  mode: AccessMode;
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

/** Kinds that the strict `approval` mode always gates, regardless of assessment. */
const ALWAYS_GATED: ReadonlySet<RiskKind> = new Set(["external_file", "network", "shell"]);

/** The access definition for a mode (defaults to `approval`). */
export function access(mode: AccessMode = DEFAULT_ACCESS_MODE): Access {
  return ACCESS_MODES[mode] ?? ACCESS_MODES[DEFAULT_ACCESS_MODE];
}

export function gate(request: GateRequest = { kind: "safe" }, mode: AccessMode = DEFAULT_ACCESS_MODE): GateDecision {
  if (!Object.hasOwn(DEFAULT_RISK_LEVEL, request.kind)) {
    throw new TypeError(`Unknown risk kind "${String(request.kind)}".`);
  }
  if (request.riskLevel !== undefined && !Object.hasOwn(RISK_LEVELS, request.riskLevel)) {
    throw new TypeError(`Unknown risk level "${String(request.riskLevel)}".`);
  }

  const inferredRisk = request.isExternal ? "high" : DEFAULT_RISK_LEVEL[request.kind];
  const riskLevel =
    request.riskLevel && RISK_LEVELS[request.riskLevel] > RISK_LEVELS[inferredRisk] ? request.riskLevel : inferredRisk;

  // `approval` always asks for external files / network / shell (`ALWAYS_GATED`);
  // `assist` only asks when the assessment is medium or higher; `full` never asks.
  const approvalRequired =
    mode === "full"
      ? false
      : mode === "assist"
        ? RISK_LEVELS[riskLevel] >= RISK_LEVELS.medium
        : ALWAYS_GATED.has(request.kind) || RISK_LEVELS[riskLevel] >= RISK_LEVELS.medium;

  if (!approvalRequired) {
    return {
      proceed: true,
      asked: false,
      mode,
      approvalRequired: false,
      riskLevel: riskLevel as "none" | "low",
      reason: request.description ?? "No risky action detected.",
    };
  }

  return {
    proceed: false,
    asked: true,
    mode,
    approvalRequired: true,
    riskLevel: riskLevel as "medium" | "high",
    reason:
      request.description ??
      (request.kind === "external_file"
        ? "External file edits require explicit approval."
        : request.kind === "network"
          ? "Outbound network access requires explicit approval."
          : request.kind === "shell"
            ? "Risky shell or command execution requires explicit approval."
            : "This action was classified as risky and requires explicit approval."),
  };
}
