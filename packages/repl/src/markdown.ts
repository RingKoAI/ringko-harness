// Render Markdown into ANSI-styled text for the terminal transcript.
//
// The transcript wraps by terminal cell width (including CJK) and prints one
// plain string per line, so Markdown is lowered to text carrying SGR codes:
// `wrap-ansi` and `string-width` ignore escape sequences when measuring width.
import { lexer, type Token, type Tokens } from "marked";
import { cleanTerminalText } from "./editor.ts";

export const MARKDOWN_LIMITS = Object.freeze({ characters: 262_144, nesting: 32, tableRule: 120 });

const ESC = "\u001b[";
const bold = (value: string): string => `${ESC}1m${value}${ESC}22m`;
const italic = (value: string): string => `${ESC}3m${value}${ESC}23m`;
const underline = (value: string): string => `${ESC}4m${value}${ESC}24m`;
const strike = (value: string): string => `${ESC}9m${value}${ESC}29m`;
const dim = (value: string): string => `${ESC}2m${value}${ESC}22m`;
const cyan = (value: string): string => `${ESC}36m${value}${ESC}39m`;

/** Heading emphasis: h1/h2 bold+underline, deeper levels bold only. */
function heading(value: string, depth: number): string {
  return depth <= 2 ? bold(underline(value)) : bold(value);
}

interface InlineToken { tokens?: Token[]; text?: string }

/** Lower inline Markdown tokens to ANSI text. */
function inline(tokens: readonly Token[] | undefined, depth = 0): string {
  if (!tokens) return "";
  if (depth >= MARKDOWN_LIMITS.nesting) return tokens.map(token => token.raw).join("");
  let out = "";
  for (const token of tokens) {
    switch (token.type) {
      case "strong": out += bold(inline((token as Tokens.Strong).tokens, depth + 1)); break;
      case "em": out += italic(inline((token as Tokens.Em).tokens, depth + 1)); break;
      case "del": out += strike(inline((token as Tokens.Del).tokens, depth + 1)); break;
      case "codespan": out += cyan((token as Tokens.Codespan).text); break;
      case "br": out += "\n"; break;
      case "link": {
        const link = token as Tokens.Link;
        out += `${underline(inline(link.tokens, depth + 1))}${link.href ? dim(` (${link.href})`) : ""}`;
        break;
      }
      case "image": {
        const image = token as Tokens.Image;
        out += `${image.text}${image.href ? dim(` (${image.href})`) : ""}`;
        break;
      }
      case "escape": out += (token as Tokens.Escape).text; break;
      case "html": out += (token as Tokens.Tag).text; break;
      default: {
        const nested = token as InlineToken;
        out += nested.tokens ? inline(nested.tokens, depth + 1) : (nested.text ?? "");
      }
    }
  }
  return out;
}

/** Lower a table cell to ANSI text. */
function cell(tokens: readonly Token[] | undefined): string {
  return inline(tokens);
}

/** Render block tokens to transcript lines, each prefixed with `indent`. */
function blocks(tokens: readonly Token[], indent: string, depth = 0): string[] {
  if (depth >= MARKDOWN_LIMITS.nesting) return tokens.map(token => indent + token.raw);
  const out: string[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const value = token as Tokens.Heading;
        out.push(indent + heading(inline(value.tokens), value.depth));
        break;
      }
      case "paragraph": {
        const value = token as Tokens.Paragraph;
        out.push(indent + inline(value.tokens));
        break;
      }
      case "code": {
        const value = token as Tokens.Code;
        for (const line of value.text.split("\n")) out.push(`${indent}${dim("│ ")}${cyan(line)}`);
        break;
      }
      case "hr":
        out.push(indent + dim("─".repeat(24)));
        break;
      case "space":
        out.push("");
        break;
      case "blockquote": {
        const value = token as Tokens.Blockquote;
        for (const line of blocks(value.tokens ?? [], "", depth + 1)) out.push(`${indent}${dim("│ ")}${dim(line)}`);
        break;
      }
      case "list": {
        const value = token as Tokens.List;
        const start = Number(value.start) || 1;
        value.items.forEach((item, index) => {
          const marker = item.task ? `[${item.checked ? "x" : " "}] ` : value.ordered ? `${start + index}. ` : "• ";
          const inner = blocks(item.tokens ?? [], "", depth + 1);
          const body = inner.length > 0 ? inner : [""];
          out.push(indent + cyan(marker) + body[0]);
          for (const line of body.slice(1)) out.push(indent + " ".repeat(marker.length) + line);
        });
        break;
      }
      case "table": {
        const value = token as Tokens.Table;
        const header = value.header.map((entry) => cell(entry.tokens));
        const rows = value.rows.map((row) => row.map((entry) => cell(entry.tokens)));
        out.push(indent + bold(header.join(" | ")));
        out.push(indent + dim("─".repeat(Math.min(MARKDOWN_LIMITS.tableRule, Math.max(3, header.join(" | ").length)))));
        for (const row of rows) out.push(indent + row.join(" | "));
        break;
      }
      case "text": {
        const value = token as Tokens.Text;
        out.push(indent + (value.tokens ? inline(value.tokens) : value.text));
        break;
      }
      default: {
        const nested = token as InlineToken;
        if (nested.tokens) out.push(...blocks(nested.tokens, indent, depth + 1));
        else if (typeof nested.text === "string" && nested.text.length > 0) out.push(indent + nested.text);
      }
    }
  }
  return out;
}

/** Render Markdown source to ANSI-annotated text (one logical line per block line). */
export function markdownToAnsi(text: string): string {
  const source = cleanTerminalText(text.slice(0, MARKDOWN_LIMITS.characters));
  const suffix = text.length > MARKDOWN_LIMITS.characters ? "\n[Markdown display truncated]" : "";
  try {
    return blocks(lexer(source), "").join("\n") + suffix;
  } catch {
    // Malformed or excessively nested Markdown must still be readable.
    return source + "\n[Markdown formatting unavailable]" + suffix;
  }
}
