import { SYNC_LIMITS, type Approval, type LoopStatus, type QuestionRequest } from "@ringko-ai/protocol";

export interface RunState {
  partial: { content: string; reasoning: string } | null;
  approvals: Map<string, Approval>;
  questions: Map<string, QuestionRequest>;
  loop: LoopStatus | null;
  error: string | null;
}
const MAX_RETAINED_RUN_ERRORS = 64;

/** Ephemeral UI state is owned by the service, so another client can attach mid-turn. */
export class RunStateManager {
  private readonly states = new Map<string, RunState>();
  private readonly errors = new Map<string, string>();
  begin(id: string): void { this.errors.delete(id); this.states.set(id, { partial: null, approvals: new Map(), questions: new Map(), loop: null, error: null }); }
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
    } else if (event === "assistant") state.partial = null;
    else if (event === "approval") { const value = data as Approval; state.approvals.set(value.id, value); }
    else if (event === "approval_closed") state.approvals.delete((data as { id: string }).id);
    else if (event === "ask") { const value = data as QuestionRequest; state.questions.set(value.id, value); }
    else if (event === "ask_closed") state.questions.delete((data as { id: string }).id);
    else if (event === "loop") state.loop = data as LoopStatus;
    else if (event === "error") state.error = (data as { message: string }).message;
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
