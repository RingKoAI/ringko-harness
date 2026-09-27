import { gate, type GateDecision, type RiskKind, type RiskLevel } from "./access.ts";

export interface ToolRiskAssessment {
  kind: RiskKind;
  level?: RiskLevel;
  reason: string;
  target?: string;
}

export interface ToolApprovalRequest {
  toolName: string;
  riskKind: RiskKind;
  reason: string;
  riskLevel: Exclude<RiskLevel, "none">;
  target?: string;
}

export type ApprovalHandler = (request: ToolApprovalRequest) => Promise<boolean>;

export interface ToolDefinition<Input, Output> {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  parseInput(value: unknown): Input;
  assessRisk(input: Input): ToolRiskAssessment | Promise<ToolRiskAssessment>;
  execute(input: Input): Output | Promise<Output>;
}

export interface ToolMetadata {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}

type RegisteredTool = {
  metadata: ToolMetadata;
  invoke(input: unknown, requestApproval?: ApprovalHandler): Promise<unknown>;
};

const RISK_KINDS = new Set<RiskKind>([
  "safe",
  "workspace_file",
  "workspace_write",
  "external_file",
  "network",
  "shell",
]);

const RISK_LEVELS = new Set<RiskLevel>(["none", "low", "medium", "high"]);

export class ApprovalHandlerUnavailableError extends Error {
  constructor(toolName: string, decision: GateDecision) {
    super(`Tool "${toolName}" requires approval, but no approval handler is configured: ${decision.reason}`);
    this.name = "ApprovalHandlerUnavailableError";
  }
}

export class ToolApprovalRejectedError extends Error {
  constructor(toolName: string) {
    super(`Approval was not granted for tool "${toolName}".`);
    this.name = "ToolApprovalRejectedError";
  }
}

export class UnknownToolError extends Error {
  constructor(toolName: string) {
    super(`No tool is registered with the name "${toolName}".`);
    this.name = "UnknownToolError";
  }
}

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export async function executeTool<Input, Output>(
  tool: ToolDefinition<Input, Output>,
  rawInput: unknown,
  requestApproval?: ApprovalHandler,
): Promise<Output> {
  const input = tool.parseInput(rawInput);
  const risk = await tool.assessRisk(input);
  if (
    !risk ||
    !RISK_KINDS.has(risk.kind) ||
    (risk.level !== undefined && !RISK_LEVELS.has(risk.level)) ||
    typeof risk.reason !== "string" ||
    risk.reason.trim().length === 0 ||
    (risk.target !== undefined && typeof risk.target !== "string")
  ) {
    throw new TypeError(`Tool "${tool.name}" returned an invalid risk assessment.`);
  }
  const decision = gate({
    kind: risk.kind,
    riskLevel: risk.level,
    description: risk.reason,
    path: risk.target,
    isExternal: risk.kind === "external_file",
  });

  if (decision.approvalRequired) {
    if (!requestApproval) {
      throw new ApprovalHandlerUnavailableError(tool.name, decision);
    }

    const approved = await requestApproval({
      toolName: tool.name,
      riskKind: risk.kind,
      reason: decision.reason ?? risk.reason,
      riskLevel: decision.riskLevel,
      target: risk.target,
    });

    if (approved !== true) {
      throw new ToolApprovalRejectedError(tool.name);
    }
  }

  return tool.execute(input);
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register<Input, Output>(tool: ToolDefinition<Input, Output>): void {
    if (!TOOL_NAME_PATTERN.test(tool.name)) {
      throw new TypeError(`Invalid tool name "${tool.name}".`);
    }
    if (tool.description.trim().length === 0) {
      throw new TypeError(`Tool "${tool.name}" must have a description.`);
    }
    if (
      typeof tool.parseInput !== "function" ||
      typeof tool.assessRisk !== "function" ||
      typeof tool.execute !== "function"
    ) {
      throw new TypeError(`Tool "${tool.name}" must provide input parsing, risk assessment, and execution.`);
    }
    if (tool.inputSchema.type !== "object") {
      throw new TypeError(`Tool "${tool.name}" must declare an object input schema.`);
    }
    if (this.tools.has(tool.name)) {
      throw new TypeError(`A tool named "${tool.name}" is already registered.`);
    }

    const metadata = Object.freeze({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
    const definition = Object.freeze({ ...tool });

    this.tools.set(tool.name, {
      metadata,
      invoke: (input, requestApproval) => executeTool(definition, input, requestApproval),
    });
  }

  list(): readonly ToolMetadata[] {
    return Array.from(this.tools.values(), ({ metadata }) => metadata);
  }

  async call(toolName: string, input: unknown, requestApproval?: ApprovalHandler): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new UnknownToolError(toolName);
    }
    return tool.invoke(input, requestApproval);
  }
}
