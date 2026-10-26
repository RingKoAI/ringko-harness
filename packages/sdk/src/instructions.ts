import { abortable, type ChatMessage } from "@ringko-ai/harness";

export const RUNTIME_INSTRUCTIONS_PREFIX = "[Runtime instructions]\n";

/** Host-owned rules are rebuilt separately from conversation summaries. */
export class InstructionContext {
  readonly enabled: boolean;
  private current = "";
  get text(): string { return this.current; }
  constructor(private readonly fixed?: string, private readonly resolve?: () => string | Promise<string>) {
    this.enabled = fixed !== undefined || resolve !== undefined;
  }

  async prepare(messages: readonly ChatMessage[], signal?: AbortSignal): Promise<ChatMessage[]> {
    if (!this.enabled) return [...messages];
    signal?.throwIfAborted();
    const current = this.resolve ? await abortable(Promise.resolve(this.resolve()), signal) : "";
    signal?.throwIfAborted();
    if (typeof current !== "string") throw new TypeError("Instruction resolver must return a string.");
    const text = [current, this.fixed].filter(value => value?.trim()).join("\n\n");
    const result = messages.filter(message => !(message.role === "system" &&
      (message.content.startsWith(RUNTIME_INSTRUCTIONS_PREFIX) || (this.fixed && message.content === this.fixed))));
    if (text) {
      // The provider adapter combines system messages in order. Current rules
      // follow unrelated system messages, including historical summaries.
      const index = result.findLastIndex(message => message.role === "system") + 1;
      result.splice(index, 0, { role: "system", content: `${RUNTIME_INSTRUCTIONS_PREFIX}${text}` });
    }
    this.current = text;
    return result;
  }
}
