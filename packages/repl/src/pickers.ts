// Reusable picker builders shared by the REPL command and shortcut surfaces.

import { discoverSkills, loadMcpServers } from "@ringko-ai/config";
import type { BackendClient } from "@ringko-ai/client";
import type { SelectorAction, SelectorItem } from "./components/Selector.tsx";
import type { SubagentView } from "./subagent-view.ts";

export interface PickerState {
  title: string;
  items: SelectorItem[];
  onSelect: (value: string) => void;
  actions?: SelectorAction[];
}

interface McpStatus {
  servers: Array<{ name: string; tools: Array<{ name: string; description?: string | null }> }>;
  errors: Array<{ name: string; message: string }>;
}

export function showSkillPicker(options: {
  workspace: string;
  setPicker: (picker: PickerState | null) => void;
  print: (text: string) => void;
}): void {
  const { workspace, setPicker, print } = options;
  const skills = discoverSkills({ cwd: workspace });
  if (skills.length === 0) { print("(no skills)"); return; }
  setPicker({
    title: "Skills",
    items: skills.map(skill => ({
      value: skill.dir,
      label: skill.name,
      description: `${skill.source} · ${skill.scope}${skill.description ? ` · ${skill.description}` : ""}`,
      group: skill.scope,
    })),
    onSelect: dir => {
      const skill = skills.find(entry => entry.dir === dir);
      if (skill) {
        print([skill.name, `${skill.source} · ${skill.scope}`, skill.dir, ...(skill.description ? [skill.description] : [])].join("\n"));
      }
      setPicker(null);
    },
  });
}

export function showMcpPicker(options: {
  workspace: string;
  backend?: BackendClient;
  setPicker: (picker: PickerState | null) => void;
  print: (text: string) => void;
}): void {
  const { workspace, backend, setPicker, print } = options;
  let configured;
  try { configured = loadMcpServers({ cwd: workspace }); }
  catch (error) { print(error instanceof Error ? error.message : "Cannot load MCP configuration."); return; }
  const show = (status?: McpStatus): void => {
    const names = [...new Set([
      ...configured.map(server => server.name),
      ...(status?.servers ?? []).map(server => server.name),
      ...(status?.errors ?? []).map(entry => entry.name),
    ])].sort();
    if (names.length === 0) { print("(no MCP servers)"); return; }
    setPicker({
      title: "MCP servers",
      items: names.map(name => {
        const config = configured.find(server => server.name === name);
        const connection = status?.servers.find(server => server.name === name);
        const failure = status?.errors.find(entry => entry.name === name);
        return {
          value: name,
          label: name,
          description: connection ? `${connection.tools.length} tools` : failure ? failure.message : config ? (config.config.url ? "http" : "stdio") : "unknown",
          group: connection ? "Connected" : failure ? "Failed" : config ? "Configured" : "Other",
        };
      }),
      onSelect: name => {
        const config = configured.find(server => server.name === name);
        const connection = status?.servers.find(server => server.name === name);
        const failure = status?.errors.find(entry => entry.name === name);
        const lines = [`${name}: ${connection ? `connected (${connection.tools.length} tools)` : failure ? "connection failed" : config ? "configured, not connected" : "unknown"}`];
        if (failure) lines.push(failure.message);
        if (connection?.tools.length) lines.push(connection.tools.map(tool => tool.name).join(", "));
        if (config) lines.push(`${config.source} · ${config.config.url ? "http" : "stdio"}`);
        print(lines.join("\n"));
        setPicker(null);
      },
    });
  };
  if (!backend) { show(); return; }
  print("loading MCP status...");
  void backend.request<McpStatus>("/api/mcp/connected").then(show).catch(error => {
    print(`cannot load MCP status: ${error instanceof Error ? error.message : String(error)}`);
    show();
  });
}

export function showTaskPicker(options: {
  taskViews: readonly SubagentView[];
  viewedTaskId?: string;
  setPicker: (picker: PickerState | null) => void;
  setViewedTaskId: (id: string | undefined) => void;
  setScrollOffset: (offset: number) => void;
  print: (text: string) => void;
}): void {
  const { taskViews, viewedTaskId, setPicker, setViewedTaskId, setScrollOffset, print } = options;
  if (!taskViews.length) { print("No subagent tasks in this session."); return; }
  setPicker({
    title: "Main / Subagent views",
    items: [
      { value: "main", label: "Main conversation", group: "Main", current: viewedTaskId === undefined },
      ...taskViews.map((task, index) => ({
        value: task.id, label: `${index === taskViews.length - 1 ? "└─" : "├─"} ${task.description}`,
        description: `${task.model} · ${task.mode} · ${task.status}${task.reason ? ` · ${task.reason}` : ""}`,
        group: "Subagents", current: viewedTaskId === task.id,
      })),
    ],
    onSelect: id => { setViewedTaskId(id === "main" ? undefined : id); setScrollOffset(0); setPicker(null); },
  });
}
