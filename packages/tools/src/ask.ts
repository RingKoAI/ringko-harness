import { defineTool, type ToolDefinition } from "@ringko-ai/harness";

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
export type AskHandler = (input: AskInput) => Promise<AskOutput>;

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function parseOption(value: unknown, where: string): AskOption {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${where} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.label !== "string" || record.label.trim().length === 0) {
    throw new TypeError(`${where} requires a non-empty 'label'.`);
  }
  if (record.description !== undefined && typeof record.description !== "string") {
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
  if (typeof record.question !== "string" || record.question.trim().length === 0) {
    throw new TypeError(`Question ${index} requires a non-empty 'question'.`);
  }
  if (record.header !== undefined && typeof record.header !== "string") {
    throw new TypeError(`Question ${index} 'header' must be a string.`);
  }
  if (record.detail !== undefined && typeof record.detail !== "string") {
    throw new TypeError(`Question ${index} 'detail' must be a string.`);
  }
  if (record.multiSelect !== undefined && typeof record.multiSelect !== "boolean") {
    throw new TypeError(`Question ${index} 'multiSelect' must be a boolean.`);
  }
  let options: AskOption[] | undefined;
  if (record.options !== undefined) {
    if (!Array.isArray(record.options)) {
      throw new TypeError(`Question ${index} 'options' must be an array.`);
    }
    options = record.options.map((option, optionIndex) => parseOption(option, `Question ${index} option ${optionIndex}`));
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
  if (!Array.isArray(list) || list.length === 0) {
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
  if (question.options && question.options.length > 0) {
    const labels = new Set(question.options.map((option) => option.label));
    for (const selected of record.selected) {
      if (!labels.has(selected)) {
        throw new TypeError(`Answer "${question.id}" selected an unknown option.`);
      }
    }
  }
  if (record.custom !== undefined && typeof record.custom !== "string") {
    throw new TypeError(`Answer "${question.id}" 'custom' must be a string.`);
  }
  return {
    id: question.id,
    selected: [...record.selected],
    ...(typeof record.custom === "string" ? { custom: record.custom } : {}),
  };
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
    async execute(input) {
      const output = await handler(input);
      if (!output || !Array.isArray(output.answers)) {
        throw new TypeError("The answer handler returned an invalid result.");
      }
      if (output.answers.length !== input.questions.length) {
        throw new TypeError("The answer handler must answer every question.");
      }
      const answers = input.questions.map((question, index) => {
        const answer = validateAnswer(output.answers[index], input.questions);
        if (answer.id !== question.id) {
          throw new TypeError("Answers must follow question order.");
        }
        return answer;
      });
      return { answers };
    },
  });
}
