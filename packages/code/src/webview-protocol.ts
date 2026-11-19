import type {
  Approval,
  BusyEnterMode,
  PendingSteer,
  QuestionOutput,
  QuestionRequest,
  SessionUsage,
  TodoItem,
} from "@ringko-ai/protocol";
import type { BackendConnectionState } from "./backend-manager.ts";
import { IDE_LIMITS } from "./limits.ts";

export type PermissionPreset = "read-only" | "default" | "full-access";

export interface IdeToolCallView {
  id: string;
  name: string;
  argsText: string;
  resultText?: string;
  failed?: boolean;
  running?: boolean;
}

export interface IdeMessageView {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  reasoning?: string;
  steered?: boolean;
  streaming?: boolean;
  runStatus?: "running" | "completed" | "cancelled" | "failed" | "interrupted";
  toolCalls?: IdeToolCallView[];
}

export interface IdeQueuedPrompt {
  id: string;
  prompt: string;
  attachments: string[];
}

export interface IdeUploadedAttachment {
  id: string;
  name: string;
  path: string;
  size: number;
  previewDataUrl?: string;
}

export interface IdeSessionSummary {
  id: string;
  title: string;
  busy: boolean;
  createdAt: number;
}

export interface IdeModelOption {
  id: string;
  label: string;
}

export interface IdeUiState {
  connection: {
    state: BackendConnectionState;
    url: string | null;
    workspace: string;
    error: string | null;
  };
  sessionId: string | null;
  sessions: IdeSessionSummary[];
  busy: boolean;
  busyEnter: BusyEnterMode;
  modelId: string | null;
  models: IdeModelOption[];
  permissionPreset: PermissionPreset;
  messages: IdeMessageView[];
  pendingSteers: PendingSteer[];
  queue: IdeQueuedPrompt[];
  approvals: Approval[];
  questions: QuestionRequest[];
  todos: TodoItem[];
  usage: SessionUsage | null;
  attachments: IdeUploadedAttachment[];
  uploadingCount: number;
  error: string | null;
}

export interface IncomingUploadFile {
  name: string;
  type: string;
  size: number;
  base64: string;
  previewDataUrl?: string;
}

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "send"; prompt: string }
  | { type: "steer"; prompt: string }
  | { type: "enqueue"; prompt: string }
  | { type: "stop" }
  | { type: "newSession" }
  | { type: "selectSession"; sessionId: string }
  | { type: "decideApproval"; id: string; approved: boolean; scope?: "session" | "saved" }
  | { type: "answerQuestion"; id: string; output?: QuestionOutput; cancel?: boolean }
  | { type: "steerQueued"; id: string }
  | { type: "steerAllQueued" }
  | { type: "removeQueued"; id: string }
  | { type: "setModel"; model: string }
  | { type: "setAccessPreset"; preset: PermissionPreset }
  | { type: "setBusyEnter"; busyEnter: BusyEnterMode }
  | { type: "attachActiveEditor" }
  | { type: "explainSelection" }
  | { type: "fixDiagnostics" }
  | { type: "uploadFiles"; files: IncomingUploadFile[] }
  | { type: "removeAttachment"; id: string }
  | { type: "openFile"; reference: string }
  | { type: "openWebUi" }
  | { type: "openTerminal" }
  | { type: "reconnect" };

export type HostToWebviewMessage =
  | { type: "state"; state: IdeUiState }
  | { type: "insertText"; text: string; focus?: boolean }
  | { type: "toast"; level: "info" | "warning" | "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= IDE_LIMITS.maxIdChars && !value.includes("\0");
}

function isPermissionPreset(value: unknown): value is PermissionPreset {
  return value === "read-only" || value === "default" || value === "full-access";
}

function parseQuestionOutput(raw: unknown): QuestionOutput | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.answers) || raw.answers.length > 32) return undefined;
  const answers: QuestionOutput["answers"] = [];
  for (const item of raw.answers) {
    if (!isRecord(item) || !isSafeId(item.id) || !Array.isArray(item.selected) || item.selected.length > 32) {
      return undefined;
    }
    const selected: string[] = [];
    for (const choice of item.selected) {
      if (typeof choice !== "string" || choice.length > 1_024) return undefined;
      selected.push(choice);
    }
    const custom = typeof item.custom === "string" ? item.custom.slice(0, 4_096) : undefined;
    answers.push({ id: item.id, selected, ...(custom !== undefined ? { custom } : {}) });
  }
  return { answers };
}

function parseUploadFiles(raw: unknown): IncomingUploadFile[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > IDE_LIMITS.maxUploadFiles) return null;
  const parsed: IncomingUploadFile[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    const name = typeof entry.name === "string" ? entry.name.trim().slice(0, 255) : "";
    const type = typeof entry.type === "string" ? entry.type.slice(0, 128) : "application/octet-stream";
    const size = typeof entry.size === "number" && Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : -1;
    const base64 = typeof entry.base64 === "string" ? entry.base64 : "";
    if (!name || name.includes("\0") || size < 0 || size > IDE_LIMITS.maxUploadFileBytes) return null;
    if (!base64 || base64.length > IDE_LIMITS.maxBase64Chars || !/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) return null;
    const previewDataUrl = typeof entry.previewDataUrl === "string" && entry.previewDataUrl.startsWith("data:image/") && entry.previewDataUrl.length <= 2 * 1024 * 1024
      ? entry.previewDataUrl
      : undefined;
    parsed.push({
      name,
      type,
      size,
      base64,
      ...(previewDataUrl ? { previewDataUrl } : {}),
    });
  }
  return parsed;
}

/** Validate untrusted messages received from the VS Code Webview sandbox. */
export function parseWebviewMessage(raw: unknown): WebviewToHostMessage | null {
  if (!isRecord(raw) || typeof raw.type !== "string") return null;

  switch (raw.type) {
    case "ready":
    case "stop":
    case "newSession":
    case "steerAllQueued":
    case "attachActiveEditor":
    case "explainSelection":
    case "fixDiagnostics":
    case "openWebUi":
    case "openTerminal":
    case "reconnect":
      return { type: raw.type };

    case "send":
    case "steer":
    case "enqueue": {
      if (typeof raw.prompt !== "string" || raw.prompt.length > IDE_LIMITS.maxPromptChars) return null;
      return { type: raw.type, prompt: raw.prompt };
    }

    case "selectSession":
      return isSafeId(raw.sessionId) ? { type: "selectSession", sessionId: raw.sessionId } : null;

    case "decideApproval": {
      if (!isSafeId(raw.id) || typeof raw.approved !== "boolean") return null;
      if (raw.scope !== undefined && raw.scope !== "session" && raw.scope !== "saved") return null;
      return {
        type: "decideApproval",
        id: raw.id,
        approved: raw.approved,
        ...(raw.scope ? { scope: raw.scope } : {}),
      };
    }

    case "answerQuestion": {
      if (!isSafeId(raw.id)) return null;
      if (raw.cancel === true) return { type: "answerQuestion", id: raw.id, cancel: true };
      const output = parseQuestionOutput(raw.output);
      return output ? { type: "answerQuestion", id: raw.id, output } : null;
    }

    case "steerQueued":
    case "removeQueued":
    case "removeAttachment":
      return isSafeId(raw.id) ? { type: raw.type, id: raw.id } : null;

    case "setModel": {
      if (typeof raw.model !== "string" || raw.model.length === 0 || raw.model.length > 256 || raw.model.includes("\0")) {
        return null;
      }
      return { type: "setModel", model: raw.model.trim() };
    }

    case "setAccessPreset":
      return isPermissionPreset(raw.preset) ? { type: "setAccessPreset", preset: raw.preset } : null;

    case "setBusyEnter":
      return raw.busyEnter === "queue" || raw.busyEnter === "steer"
        ? { type: "setBusyEnter", busyEnter: raw.busyEnter }
        : null;

    case "uploadFiles": {
      const files = parseUploadFiles(raw.files);
      return files ? { type: "uploadFiles", files } : null;
    }

    case "openFile": {
      if (typeof raw.reference !== "string" || raw.reference.length === 0 || raw.reference.length > IDE_LIMITS.maxReferenceChars) {
        return null;
      }
      return { type: "openFile", reference: raw.reference };
    }

    default:
      return null;
  }
}
