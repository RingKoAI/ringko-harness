import { createSkill, discoverSkills, removeSkill } from "@ringko-ai/config";
import type { CliIo, ParsedArgs } from "../types.ts";

export function skillsCommand(parsed: ParsedArgs, io: CliIo): number {
  const [sub, name, ...rest] = parsed.positionals;
  if (sub === "create") {
    if (!name) {
      io.err("skills create requires <name> [description].");
      return 2;
    }
    try {
      createSkill({ name, ...(rest.length > 0 ? { description: rest.join(" ") } : {}) });
    } catch (error) {
      io.err(error instanceof Error ? error.message : "Cannot create skill.");
      return 1;
    }
    io.out(`created skill ${name}.`);
    return 0;
  }
  if (sub === "remove") {
    if (!name) {
      io.err("skills remove requires <name>.");
      return 2;
    }
    const skill = discoverSkills().find((entry) => entry.name === name);
    if (!skill) {
      io.err(`unknown skill "${name}".`);
      return 1;
    }
    try {
      removeSkill(skill.dir);
    } catch (error) {
      io.err(error instanceof Error ? error.message : "Cannot remove skill.");
      return 1;
    }
    io.out(`removed skill ${name}.`);
    return 0;
  }
  for (const skill of discoverSkills()) {
    const description = skill.description ? `\t${skill.description}` : "";
    io.out(`${skill.name}\t${skill.source}\t${skill.dir}${description}`);
  }
  return 0;
}
