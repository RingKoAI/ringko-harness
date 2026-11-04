// Per-workspace tool assembly.
//
// ToolManager owns the built-in tool registration path and the sandbox each
// agent uses. RuntimeManager wires it as the `core/tools` contribution; other
// sub-managers (capabilities, MCP) stay out of tool registration.

import type { RingkoConfig, Skill } from "@ringko-ai/config";
import type { SessionHandle } from "@ringko-ai/session";
import type { Sandbox } from "@ringko-ai/tools";
import type { RingKo } from "./index.ts";
import type { RuntimeContribution, RuntimeHost } from "./runtime-contribution.ts";
import { registerRuntimeTools } from "./runtime-tools.ts";

export class ToolManager {
  private readonly sandboxes = new WeakMap<RingKo, Sandbox>();

  constructor(
    private readonly workspace: string,
    private readonly skills: () => readonly Skill[],
  ) {}

  /** Register built-in tools on one agent and remember its sandbox. */
  register(agent: RingKo, config: RingkoConfig, host: RuntimeHost = {}, session?: SessionHandle): Sandbox {
    const sandbox = registerRuntimeTools(agent, config, this.workspace, host, session, this.skills());
    this.sandboxes.set(agent, sandbox);
    return sandbox;
  }

  sandboxFor(agent: RingKo): Sandbox | undefined {
    return this.sandboxes.get(agent);
  }

  /** The built-in contribution installed by RuntimeManager. */
  contribution(): RuntimeContribution {
    return {
      name: "core/tools",
      setup: context => {
        context.onAgent((agent, config, agentContext) => {
          this.register(agent, config, agentContext.host, agentContext.session);
        });
      },
    };
  }
}
