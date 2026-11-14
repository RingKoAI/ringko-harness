export const TOOL_INPUT_PREVIEW_LIMITS = { calls: 128, characters: 16_384, identifierCharacters: 512 } as const;
export type ToolInputDelta = { kind: "start"; id: string; name: string } | { kind: "delta"; id: string; text: string } | { kind: "end"; id: string };
export interface ToolInputPreview { id: string; name: string; text: string; complete: boolean; truncated: boolean }
export interface PartialResponse { content: string; reasoning: string; toolInputs?: ToolInputPreview[] }

export function isToolInputDelta(value: unknown): value is ToolInputDelta {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  if (typeof data.id !== "string" || !data.id || data.id.length > TOOL_INPUT_PREVIEW_LIMITS.identifierCharacters) return false;
  return data.kind === "start" ? typeof data.name === "string" && data.name.length > 0 && data.name.length <= TOOL_INPUT_PREVIEW_LIMITS.identifierCharacters
    : data.kind === "delta" ? typeof data.text === "string" : data.kind === "end";
}

/** Bounded transient preview, never parsed as executable arguments or stored in model history. */
export function applyToolInputDelta(previous: readonly ToolInputPreview[] = [], value: unknown): ToolInputPreview[] {
  if (!isToolInputDelta(value)) return [...previous];
  if (value.kind === "start") {
    if (previous.length >= TOOL_INPUT_PREVIEW_LIMITS.calls || previous.some(item => item.id === value.id)) return [...previous];
    return [...previous, { id: value.id, name: value.name, text: "", complete: false, truncated: false }];
  }
  return previous.map(item => {
    if (item.id !== value.id || item.complete) return item;
    if (value.kind === "end") return { ...item, complete: true };
    const room = Math.max(0, TOOL_INPUT_PREVIEW_LIMITS.characters - item.text.length);
    return { ...item, text: item.text + value.text.slice(0, room), truncated: item.truncated || value.text.length > room };
  });
}
