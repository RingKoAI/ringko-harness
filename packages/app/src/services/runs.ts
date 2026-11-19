import { applyToolInputDelta, SYNC_LIMITS, type PartialResponse, type Approval, type LoopStatus, type PendingSteer, type QuestionRequest } from "@ringko-ai/protocol";

export interface RunState {
  partial: PartialResponse | null;
  approvals: Map<string, Approval>;
  questions: Map<string, QuestionRequest>;
  steering: PendingSteer[];
  loop: LoopStatus | null;
  error: string | null;
}
const MAX_RETAINED_RUN_ERRORS = 64;

/** Ephemeral UI state is owned by the service, so another client can attach mid-turn. */
export class RunStateManager {
  private readonly states = new Map<string, RunState>();
  private readonly errors = new Map<string, string>();
  begin(id: string): void { this.errors.delete(id); this.states.set(id, { partial: null, approvals: new Map(), questions: new Map(), steering: [], loop: null, error: null }); }
  get(id: string): RunState | undefined { return this.states.get(id); }
  error(id: string): string | undefined { return this.errors.get(id); }
  update(id: string, event: string, data: unknown): void {
    const state = this.states.get(id);
    if (!state) return;
    if (event === "delta") {
      const delta = data as { kind: string; text: string };
      const key = delta.kind === "reasoning" ? "reasoning" : "content";
      const partial = state.partial ?? { content: "", reasoning: "" };
      partial[key] = (partial[key] + delta.text).slice(0, SYNC_LIMITS.partialCharacters);
      state.partial = partial;
    } else if (event === "tool_input") {
      const partial = state.partial ?? { content: "", reasoning: "" };
      state.partial = { ...partial, toolInputs: applyToolInputDelta(partial.toolInputs, data) };
    } else if (event === "assistant") state.partial = null;
    else if (event === "steering") {
      const value = data as PendingSteer;
      if (value?.id && typeof value.content === "string" && !state.steering.some(item => item.id === value.id)) {
        state.steering.push({ id: value.id, content: value.content });
      }
    } else if (event === "user") {
      const inputId = (data as { id?: unknown } | null)?.id;
      if (typeof inputId === "string") state.steering = state.steering.filter(item => item.id !== inputId);
    } else if (event === "cancelled") { state.partial = null; state.steering = []; state.error = null; }
    else if (event === "approval") { const value = data as Approval; state.approvals.set(value.id, value); }
    else if (event === "approval_closed") state.approvals.delete((data as { id: string }).id);
    else if (event === "ask") { const value = data as QuestionRequest; state.questions.set(value.id, value); }
    else if (event === "ask_closed") state.questions.delete((data as { id: string }).id);
    else if (event === "loop") state.loop = data as LoopStatus;
    else if (event === "error") { state.error = (data as { message: string }).message; state.partial = null; state.steering = []; }
  }
  finish(id: string): void {
    const error = this.states.get(id)?.error;
    if (error) {
      this.errors.set(id, error);
      if (this.errors.size > MAX_RETAINED_RUN_ERRORS) { const oldest = this.errors.keys().next().value; if (oldest !== undefined) this.errors.delete(oldest); }
    }
    this.states.delete(id);
  }
}
