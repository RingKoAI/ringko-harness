/** Preserve existing permission/workflow rules across the plan-tool rename. */
export function canonicalToolName(name: string): string {
  if (name === "todoread") return "plan";
  if (name === "todowrite") return "update_plan";
  return name;
}
