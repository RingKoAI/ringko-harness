import type { RingkoConfig } from "@ringko-ai/config";
import { sessionTodos, type SessionHandle } from "@ringko-ai/session";
import {
  Sandbox,
  createTodoStore,
  registerNetworkTools,
  registerSessionQueryTools,
  registerSessionTools,
  registerShellTools,
  registerWorkspaceTools,
} from "@ringko-ai/tools";
import { resolveWorkflow, workflowAllowsTool } from "@ringko-ai/workflow";
import type { RingKo } from "./index.ts";
import type { RuntimeContribution, RuntimeHost } from "./runtime-contribution.ts";
import { registerRuntimeSkills } from "./skills.ts";

/** Remove tools excluded by the workspace workflow policy. */
export function applyToolPolicy(agent: RingKo, workflow: ReturnType<typeof resolveWorkflow>): void {
  for (const tool of agent.tools.list()) if (!workflowAllowsTool(workflow, tool.name)) agent.tools.unregister(tool.name);
}

/** Shared tool assembly for executing agents and capability previews. */
export function registerRuntimeTools(
  agent: RingKo,
  config: RingkoConfig,
  workspace: string,
  host: RuntimeHost = {},
  session?: SessionHandle,
): Sandbox {
  const sandbox = new Sandbox({ workspace, mode: config.sandbox?.mode, additionalWritableRoots: config.sandbox?.additionalWritableRoots });
  registerWorkspaceTools(agent.tools, { workspace, sandbox });
  const todos = createTodoStore(items => {
    if (session) { session.appendEvent("session/todo", { todos: items }); session.flush(); }
    host.onTodo?.(items);
  });
  todos.todos = session ? sessionTodos(session.all()) : [];
  registerSessionTools(agent.tools, { todos, ask: host.ask ?? (async () => { throw new Error("Questions require an interactive host."); }) });
  registerSessionQueryTools(agent.tools, { workspace });
  if (config.capabilities?.network) registerNetworkTools(agent.tools, {
    allowPrivateHosts: config.capabilities.privateNetwork === true,
    search: { provider: config.capabilities.websearchProvider },
  });
  if (config.capabilities?.shell) registerShellTools(agent.tools, { cwd: workspace, sandbox });
  registerRuntimeSkills(agent.tools, workspace);
  applyToolPolicy(agent, resolveWorkflow(config.workflow));
  return sandbox;
}

/** The built-in workspace tools, registered as the first runtime contribution. */
export function createRuntimeToolsContribution(): {
  contribution: RuntimeContribution;
  sandboxFor(agent: RingKo): Sandbox | undefined;
} {
  const sandboxes = new WeakMap<RingKo, Sandbox>();
  return {
    contribution: {
      name: "core/tools",
      setup(context) {
        context.onAgent((agent, config, agentContext) => {
          sandboxes.set(agent, registerRuntimeTools(agent, config, context.workspace, agentContext.host, agentContext.session));
        });
      },
    },
    sandboxFor: agent => sandboxes.get(agent),
  };
}
