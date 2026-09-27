import {
  DEFAULT_ACCESS_MODE,
  gate,
  type AccessMode,
  type GateDecision,
  type RiskKind,
  type RiskLevel,
} from "./access.ts";

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

/** How a tool participates in same-turn scheduling. */
export type ToolConcurrency = "parallel" | "exclusive";

export interface ToolDefinition<Input, Output> {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  parseInput(value: unknown): Input;
  assessRisk(input: Input): ToolRiskAssessment | Promise<ToolRiskAssessment>;
  execute(input: Input): Output | Promise<Output>;
  /**
   * `"exclusive"` tools run alone as a barrier: the scheduler drains every
   * earlier call, runs this one by itself, then continues. Defaults to
   * `"parallel"` (batched with neighbouring parallel calls, bounded by the
   * agent's concurrency limit).
   */
  concurrency?: ToolConcurrency;
}

export interface ToolMetadata {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  /** Set by the registry; absent means the default `"parallel"` schedule. */
  concurrency?: ToolConcurrency;
}

/**
 * A tool whose input/output types are erased, used when registering or
 * dispatching a heterogeneous bundle. The registry never exposes executors, so
 * callers only ever see {@link ToolMetadata}.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, any>;

type RegisteredTool = {
  metadata: ToolMetadata;
  invoke(input: unknown, requestApproval?: ApprovalHandler, mode?: AccessMode): Promise<unknown>;
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

/**
 * Enforce the shape every registerable tool must have. This is the only place a
 * capability can enter the harness, so a definition that cannot be mediated
 * (no parser, no risk assessor, no executor, or a non-object schema) is
 * rejected before it can reach the registry.
 */
const CONCURRENCY = new Set<ToolConcurrency>(["parallel", "exclusive"]);

export function validateToolDefinition(tool: ToolDefinition<unknown, unknown>): void {
  if (tool.concurrency !== undefined && !CONCURRENCY.has(tool.concurrency)) {
    throw new TypeError(`Tool "${tool.name}" has an invalid concurrency "${String(tool.concurrency)}".`);
  }

  if (!tool || typeof tool !== "object") {
    throw new TypeError("A tool definition is required.");
  }
  if (typeof tool.name !== "string" || !TOOL_NAME_PATTERN.test(tool.name)) {
    throw new TypeError(`Invalid tool name "${String(tool.name)}".`);
  }
  if (typeof tool.description !== "string" || tool.description.trim().length === 0) {
    throw new TypeError(`Tool "${tool.name}" must have a description.`);
  }
  if (
    typeof tool.parseInput !== "function" ||
    typeof tool.assessRisk !== "function" ||
    typeof tool.execute !== "function"
  ) {
    throw new TypeError(`Tool "${tool.name}" must provide input parsing, risk assessment, and execution.`);
  }
  if (!tool.inputSchema || typeof tool.inputSchema !== "object" || tool.inputSchema.type !== "object") {
    throw new TypeError(`Tool "${tool.name}" must declare an object input schema.`);
  }
}

/**
 * Validate and freeze a tool definition. Authoring helpers call this so that
 * mistakes surface where the tool is written, not when it is first invoked.
 * The result is deeply frozen against later mutation.
 */
export function defineTool<Input, Output>(tool: ToolDefinition<Input, Output>): ToolDefinition<Input, Output> {
  validateToolDefinition(tool as ToolDefinition<unknown, unknown>);
  return Object.freeze({
    ...tool,
    inputSchema: Object.freeze({ ...tool.inputSchema }),
  });
}

export async function executeTool<Input, Output>(
  tool: ToolDefinition<Input, Output>,
  rawInput: unknown,
  requestApproval?: ApprovalHandler,
  mode: AccessMode = DEFAULT_ACCESS_MODE,
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
  const decision = gate(
    {
      kind: risk.kind,
      riskLevel: risk.level,
      description: risk.reason,
      path: risk.target,
      isExternal: risk.kind === "external_file",
    },
    mode,
  );

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

/**
 * The allowlist of tools a host has chosen to expose. It is the only way to
 * reach a tool executor: `register` adds a capability, `list`/`get` expose
 * metadata only, and `call` runs the full approval pipeline. Executors are
 * captured in a closure and never returned.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register<Input, Output>(tool: ToolDefinition<Input, Output>): void {
    validateToolDefinition(tool as ToolDefinition<unknown, unknown>);
    if (this.tools.has(tool.name)) {
      throw new TypeError(`A tool named "${tool.name}" is already registered.`);
    }
    const definition = defineTool(tool);
    const metadata: ToolMetadata = Object.freeze({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      concurrency: definition.concurrency ?? "parallel",
    });
    this.tools.set(definition.name, {
      metadata,
      invoke: (input, requestApproval, mode) => executeTool(definition, input, requestApproval, mode),
    });
  }

  /**
   * Register a bundle of tools atomically: every definition is validated and
   * checked for collisions (against the batch and the registry) before anything
   * is added, so one bad tool registers none of them.
   */
  registerAll(tools: readonly AnyToolDefinition[]): void {
    const pending = new Set<string>();
    for (const tool of tools) {
      validateToolDefinition(tool as ToolDefinition<unknown, unknown>);
      if (this.tools.has(tool.name) || pending.has(tool.name)) {
        throw new TypeError(`A tool named "${tool.name}" is already registered.`);
      }
      pending.add(tool.name);
    }
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /** True when a tool with this name is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Metadata for a registered tool, or undefined. Never the executor. */
  get(name: string): ToolMetadata | undefined {
    return this.tools.get(name)?.metadata;
  }

  /** Number of registered tools. */
  size(): number {
    return this.tools.size;
  }

  /** Registered tool names, in registration order. */
  names(): readonly string[] {
    return Array.from(this.tools.keys());
  }

  list(): readonly ToolMetadata[] {
    return Array.from(this.tools.values(), ({ metadata }) => metadata);
  }

  async call(
    toolName: string,
    input: unknown,
    requestApproval?: ApprovalHandler,
    mode: AccessMode = DEFAULT_ACCESS_MODE,
  ): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new UnknownToolError(toolName);
    }
    return tool.invoke(input, requestApproval, mode);
  }
}
