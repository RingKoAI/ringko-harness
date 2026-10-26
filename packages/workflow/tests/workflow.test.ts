import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_WORKFLOW_ID, listWorkflows, resolveWorkflow, routeWorkflow, workflowAllowsTool } from "../src/index.ts";

let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ringko-workflow-"));
  env = { RINGKO_HOME: home } as NodeJS.ProcessEnv;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("workflows", () => {
  it("lists the built-in workflows", () => {
    expect(listWorkflows(env).map((workflow) => workflow.id).sort()).toEqual(["agent", "ask", "debug", "plan"]);
  });

  it("resolves the default and merges user overrides", () => {
    expect(resolveWorkflow(undefined, env).id).toBe(DEFAULT_WORKFLOW_ID);
    mkdirSync(join(home, ".ringko"), { recursive: true });
    writeFileSync(
      join(home, ".ringko", "workflows.json"),
      JSON.stringify({ workflows: { plan: { instructions: "custom plan" } } }),
    );
    const plan = resolveWorkflow("plan", env);
    expect(plan.instructions).toBe("custom plan");
    expect(plan.label).toBe("Plan");
  });

  it("routes a workflow into instructions", () => {
    const route = routeWorkflow(resolveWorkflow("plan", env));
    expect(route.id).toBe("plan");
    expect(route.instructions.length).toBeGreaterThan(0);
  });

  it("keeps historical plan-tool rules effective with deny taking precedence", () => {
    const workflow = { id: "restricted", builtin: false, tools: { allow: ["todoread", "todowrite"], deny: ["todowrite"] } };
    expect(workflowAllowsTool(workflow, "plan")).toBe(true);
    expect(workflowAllowsTool(workflow, "update_plan")).toBe(false);
    expect(workflowAllowsTool(workflow, "shell")).toBe(false);
    expect(workflowAllowsTool({ ...workflow, tools: { allow: ["plan", "update_plan"] } }, "update_plan")).toBe(true);
  });
});
