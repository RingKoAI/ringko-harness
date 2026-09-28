import { defineTool, abortable, type ToolDefinition, type ToolExecutionContext } from "@ringko-ai/harness";
import { randomUUID } from "node:crypto";

export interface AskOption {
  label: string;
  description?: string;
}

export interface AskQuestion {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: AskOption[];
  multiSelect?: boolean;
}

export interface AskInput {
  questions: AskQuestion[];
}

export interface AskAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

export interface AskOutput {
  answers: AskAnswer[];
}

/**
 * Host-supplied answerer. The tool does not render UI; without an answerer the
 * call fails closed so the model sees an error instead of hanging.
 */
export type AskHandler = (input: AskInput, context?: ToolExecutionContext) => Promise<AskOutput>;
export const ASK_LIMITS = Object.freeze({ questions: 4, options: 8, textCharacters: 4096, answerCharacters: 8192 });

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function parseOption(value: unknown, where: string): AskOption {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${where} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.label !== "string" || record.label.trim().length === 0 || record.label.length > ASK_LIMITS.textCharacters) {
    throw new TypeError(`${where} requires a non-empty 'label'.`);
  }
  if (record.description !== undefined && (typeof record.description !== "string" || record.description.length > ASK_LIMITS.textCharacters)) {
    throw new TypeError(`${where} 'description' must be a string.`);
  }
  return {
    label: record.label,
    ...(typeof record.description === "string" ? { description: record.description } : {}),
  };
}

function parseQuestion(value: unknown, index: number): AskQuestion {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Question ${index} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !ID_PATTERN.test(record.id)) {
    throw new TypeError(`Question ${index} requires an id of letters, digits, '_' or '-'.`);
  }
  if (typeof record.question !== "string" || record.question.trim().length === 0 || record.question.length > ASK_LIMITS.textCharacters) {
    throw new TypeError(`Question ${index} requires a non-empty 'question'.`);
  }
  if (record.header !== undefined && (typeof record.header !== "string" || record.header.length > ASK_LIMITS.textCharacters)) {
    throw new TypeError(`Question ${index} 'header' must be a string.`);
  }
  if (record.detail !== undefined && (typeof record.detail !== "string" || record.detail.length > ASK_LIMITS.textCharacters)) {
    throw new TypeError(`Question ${index} 'detail' must be a string.`);
  }
  if (record.multiSelect !== undefined && typeof record.multiSelect !== "boolean") {
    throw new TypeError(`Question ${index} 'multiSelect' must be a boolean.`);
  }
  let options: AskOption[] | undefined;
  if (record.options !== undefined) {
    if (!Array.isArray(record.options) || record.options.length > ASK_LIMITS.options) {
      throw new TypeError(`Question ${index} 'options' must be an array.`);
    }
    options = record.options.map((option, optionIndex) => parseOption(option, `Question ${index} option ${optionIndex}`));
    if (new Set(options.map(option => option.label)).size !== options.length) throw new TypeError("Option labels must be unique.");
  }
  return {
    id: record.id,
    question: record.question,
    ...(typeof record.header === "string" ? { header: record.header } : {}),
    ...(typeof record.detail === "string" ? { detail: record.detail } : {}),
    ...(options ? { options } : {}),
    ...(typeof record.multiSelect === "boolean" ? { multiSelect: record.multiSelect } : {}),
  };
}

function parseAsk(value: unknown): AskInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  const list = (value as Record<string, unknown>).questions;
  if (!Array.isArray(list) || list.length === 0 || list.length > ASK_LIMITS.questions) {
    throw new TypeError("Expected a non-empty array 'questions'.");
  }
  const questions = list.map((entry, index) => parseQuestion(entry, index));
  const ids = new Set<string>();
  for (const question of questions) {
    if (ids.has(question.id)) {
      throw new TypeError(`Duplicate question id "${question.id}".`);
    }
    ids.add(question.id);
  }
  return { questions };
}

function validateAnswer(answer: unknown, questions: readonly AskQuestion[]): AskAnswer {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) {
    throw new TypeError("Each answer must be an object.");
  }
  const record = answer as Record<string, unknown>;
  const question = questions.find((item) => item.id === record.id);
  if (!question || typeof record.id !== "string") {
    throw new TypeError("Answer id does not match a question.");
  }
  if (!Array.isArray(record.selected) || record.selected.some((item) => typeof item !== "string")) {
    throw new TypeError(`Answer "${question.id}" requires a string array 'selected'.`);
  }
  if (!question.multiSelect && record.selected.length > 1) {
    throw new TypeError(`Answer "${question.id}" allows only one selection.`);
  }
  if (new Set(record.selected).size !== record.selected.length) throw new TypeError("Duplicate answer selections.");
  if ((!question.options?.length && record.selected.length) || record.selected.length > ASK_LIMITS.options) throw new TypeError("Selections require question options.");
  if (question.options && question.options.length > 0) {
    const labels = new Set(question.options.map((option) => option.label));
    for (const selected of record.selected) {
      if (!labels.has(selected)) {
        throw new TypeError(`Answer "${question.id}" selected an unknown option.`);
      }
    }
  }
  if (record.custom !== undefined && (typeof record.custom !== "string" || record.custom.length > ASK_LIMITS.answerCharacters)) {
    throw new TypeError(`Answer "${question.id}" 'custom' must be a string.`);
  }
  return {
    id: question.id,
    selected: [...record.selected],
    ...(typeof record.custom === "string" ? { custom: record.custom } : {}),
  };
}

export function validateAskOutput(input: AskInput, output: unknown): AskOutput {
  if (!output || typeof output !== "object" || !Array.isArray((output as AskOutput).answers)) throw new TypeError("The answer handler returned an invalid result.");
  const values = (output as AskOutput).answers;
  if (values.length !== input.questions.length) throw new TypeError("The answer handler must answer every question.");
  const answers = input.questions.map((question, index) => {
    const answer = validateAnswer(values[index], input.questions);
    if (answer.id !== question.id) throw new TypeError("Answers must follow question order.");
    return answer;
  });
  return { answers };
}
export interface AskEvent { id: string; type: "requested" | "answered" | "cancelled"; input?: AskInput; output?: AskOutput }
interface PendingQuestion { id: string; input: AskInput; resolve: (value: AskOutput) => void; reject: (error: Error) => void; cleanup: () => void }
/** Serializes questions from parent and background children; cancellation removes queued requests. */
export class AskManager {
  private queue: PendingQuestion[] = [];
  constructor(private readonly onEvent: (event: AskEvent) => void) {}
  readonly request: AskHandler = (input, context) => new Promise((resolve, reject) => {
    context?.signal?.throwIfAborted();
    if (this.queue.length >= ASK_LIMITS.questions) throw new Error("Too many pending questions.");
    const id = randomUUID();
    const cancel = () => this.finish(id);
    const timer = setTimeout(cancel, 300_000);
    const pending: PendingQuestion = { id, input, resolve, reject, cleanup: () => { clearTimeout(timer); context?.signal?.removeEventListener("abort", cancel); } };
    this.queue.push(pending);
    context?.signal?.addEventListener("abort", cancel, { once: true });
    if (context?.signal?.aborted) cancel(); else if (this.queue.length === 1) this.publish(pending);
  });
  private publish(pending: PendingQuestion): void {
    try { this.onEvent({ id: pending.id, type: "requested", input: pending.input }); }
    catch { this.finish(pending.id); }
  }
  respond(id: string, output?: unknown): void {
    const pending = this.queue[0];
    if (!pending || pending.id !== id) throw new Error("No matching active question.");
    this.finish(id, output === undefined ? undefined : validateAskOutput(pending.input, output));
  }
  private finish(id: string, output?: AskOutput): void {
    const index = this.queue.findIndex(item => item.id === id);
    if (index < 0) return;
    const [pending] = this.queue.splice(index, 1);
    pending.cleanup();
    try { this.onEvent({ id, type: output ? "answered" : "cancelled", ...(output ? { output } : {}) }); }
    catch { output = undefined; }
    if (output) pending.resolve(output); else pending.reject(new Error("Question cancelled or expired."));
    if (index === 0 && this.queue[0]) this.publish(this.queue[0]);
  }
  cancelAll(): void { for (const pending of [...this.queue]) this.finish(pending.id); }
}

/**
 * Pause for a human decision. Exclusive so it does not overlap other work, and
 * safe because it only waits on the host answerer.
 */
export function createAskTool(handler: AskHandler): ToolDefinition<AskInput, AskOutput> {
  if (typeof handler !== "function") {
    throw new TypeError("ask requires an answer handler.");
  }
  return defineTool<AskInput, AskOutput>({
    name: "ask",
    concurrency: "exclusive",
    description:
      "Ask the user one or more questions and wait for the answers. Use for a confirmation, a choice, or missing information. Each question needs a stable id. Put the recommended option first. Returns one answer per question.",
    inputSchema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              question: { type: "string" },
              header: { type: "string" },
              detail: { type: "string" },
              multiSelect: { type: "boolean" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["label"],
                },
              },
            },
            required: ["id", "question"],
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
    parseInput: parseAsk,
    assessRisk() {
      return { kind: "safe", reason: "Ask the user a question." };
    },
    async execute(input, context) {
      const output = await abortable(handler(input, context), context?.signal);
      context?.signal?.throwIfAborted();
      return validateAskOutput(input, output);
    },
  });
}
