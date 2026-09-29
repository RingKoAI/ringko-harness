import { open } from "node:fs/promises";
import { join } from "node:path";
import { discoverSkills, SKILL_FILE_NAME } from "@ringko-ai/config";
import { defineTool, type ToolRegistry } from "@ringko-ai/harness";

const MAX_SKILLS = 256;
const MAX_SKILL_BYTES = 64 * 1024;

/** Only discovered skill names can select a file; callers supply no paths. */
export function registerRuntimeSkills(registry: ToolRegistry, workspace: string): void {
  const skills = discoverSkills({ cwd: workspace }).slice(0, MAX_SKILLS);
  if (skills.length === 0) return;
  registry.register(defineTool<{ name: string }, string>({
    name: "skill",
    description: "Load an installed skill's instructions before applying it. Available skills: " + skills.map(skill => `${skill.name}: ${(skill.description ?? "").slice(0, 200)}`).join("; "),
    inputSchema: { type: "object", properties: { name: { type: "string", enum: skills.map(skill => skill.name) } }, required: ["name"], additionalProperties: false },
    parseInput(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Skill input must be an object.");
      const name = (value as { name?: unknown }).name;
      if (typeof name !== "string" || !skills.some(skill => skill.name === name) || Object.keys(value).some(key => key !== "name")) throw new TypeError("Unknown skill name.");
      return { name };
    },
    assessRisk: input => ({ kind: "safe", reason: `Read installed skill ${input.name}.` }),
    async execute(input) {
      const skill = skills.find(skill => skill.name === input.name);
      if (!skill) throw new Error("Skill is no longer available.");
      const file = await open(join(skill.dir, SKILL_FILE_NAME), "r");
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) throw new Error("Skill must be a regular file no larger than 64 KiB.");
        const buffer = Buffer.alloc(MAX_SKILL_BYTES + 1);
        let total = 0;
        while (total < buffer.length) {
          const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
          if (!bytesRead) break;
          total += bytesRead;
        }
        if (total > MAX_SKILL_BYTES) throw new Error("Skill exceeds 64 KiB.");
        return `Instructions from: ${join(skill.dir, SKILL_FILE_NAME)}\n${buffer.subarray(0, total).toString("utf8")}`;
      } finally { await file.close(); }
    },
  }));
}
