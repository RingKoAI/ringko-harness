// Self-referential loop: re-run the same prompt until the completion promise
// appears in a reply or the iteration budget is spent. Pure helpers shared by
// the TUI, CLI and Web hosts.

export interface LoopOptions {
  prompt: string;
  /** 0 means unlimited (stop only via the completion promise or cancellation). */
  maxIterations: number;
  completionPromise?: string;
}

export type LoopParse =
  | { ok: true; options: LoopOptions }
  | { ok: false; error: string };

/** Split on whitespace, honoring single/double quotes so a promise can hold spaces. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let started = false;
  for (const char of input) {
    if (quote) {
      if (char === quote) { quote = undefined; continue; }
      current += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (/\s/.test(char)) {
      if (started) { tokens.push(current); current = ""; started = false; }
      continue;
    }
    current += char;
    started = true;
  }
  if (quote) return [];
  if (started) tokens.push(current);
  return tokens;
}

export function parseLoopArgs(arg: string): LoopParse {
  const tokens = tokenize(arg);
  if (tokens.length === 0) return { ok: false, error: "Usage: /loop <prompt> [--max-iterations N] [--completion-promise TEXT]" };
  const promptParts: string[] = [];
  let maxIterations = 0;
  let completionPromise: string | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--max-iterations") {
      const value = tokens[index + 1];
      if (value === undefined) return { ok: false, error: "--max-iterations requires a non-negative integer." };
      if (!/^\d+$/.test(value)) return { ok: false, error: `--max-iterations must be a non-negative integer, got "${value}".` };
      maxIterations = Number(value);
      index += 1;
      continue;
    }
    if (token === "--completion-promise") {
      const value = tokens[index + 1];
      if (value === undefined || value.length === 0) return { ok: false, error: "--completion-promise requires text." };
      completionPromise = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--")) return { ok: false, error: `Unknown option "${token}".` };
    promptParts.push(token);
  }
  const prompt = promptParts.join(" ").trim();
  if (prompt.length === 0) return { ok: false, error: "Provide a task prompt: <prompt> [--max-iterations N] [--completion-promise TEXT]" };
  return { ok: true, options: { prompt, maxIterations, ...(completionPromise !== undefined ? { completionPromise } : {}) } };
}

/** Extract the first `<promise>…</promise>` value, whitespace-normalized. */
export function promiseText(content: string): string | undefined {
  const match = /<promise>([\s\S]*?)<\/promise>/.exec(content);
  if (!match) return undefined;
  const value = match[1]!.replace(/\s+/g, " ").trim();
  return value.length > 0 ? value : undefined;
}

/** The prompt sent to the model: the task plus (when set) the completion contract. */
export function loopPrompt(options: LoopOptions): string {
  if (!options.completionPromise) return options.prompt;
  return `${options.prompt}\n\nWhen and only when this task is genuinely complete, reply with exactly <promise>${options.completionPromise}</promise>. Do not emit it otherwise.`;
}
