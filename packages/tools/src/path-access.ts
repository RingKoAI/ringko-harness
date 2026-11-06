import type { ToolRiskAssessment } from "@ringko-ai/harness";
import { alternateSpellings, type ResolvedPathTarget } from "./workspace.ts";

/**
 * Shared classification for path-reading tools. The approved target is the
 * canonical path; the caller's spelling travels as an alternate so deny rules
 * cannot be dodged by addressing the same file through a link.
 */
export function pathRisk(target: ResolvedPathTarget, verb: "Read" | "Grep" | "Glob"): ToolRiskAssessment {
  const alternates = alternateSpellings(target);
  const extra = alternates.length > 0 ? { alternates } : {};
  if (!target.resolved) {
    return {
      kind: "external_file",
      reason: `${verb} an unresolvable path: ${target.absolute}.`,
      target: target.absolute,
      ...extra,
    };
  }
  return target.insideWorkspace
    ? { kind: "workspace_file", reason: `${verb} workspace path ${target.relative || "."}.`, target: target.absolute, ...extra }
    : { kind: "external_file", reason: `${verb} outside the workspace: ${target.absolute}.`, target: target.absolute, ...extra };
}
