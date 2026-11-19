import { randomBytes } from "node:crypto";

export type IdeLocale = "en" | "zh-CN";

interface WebviewStrings {
  connected: string;
  connecting: string;
  disconnected: string;
  error: string;
  reconnect: string;
  newSession: string;
  noSessions: string;
  noModel: string;
  presetReadOnly: string;
  presetDefault: string;
  presetFull: string;
  emptyTitle: string;
  emptySubtitle: string;
  quickMention: string;
  quickExplain: string;
  quickFix: string;
  quickTerminal: string;
  quickWebUi: string;
  roleUser: string;
  roleModel: string;
  steeredBadge: string;
  pendingSteerBadge: string;
  reasoningLabel: string;
  toolRunning: string;
  toolFailed: string;
  toolDone: string;
  copyCode: string;
  copiedCode: string;
  approvalTitle: string;
  allowOnce: string;
  allowSession: string;
  allowAlways: string;
  deny: string;
  questionTitle: string;
  customAnswerPlaceholder: string;
  submitAnswer: string;
  cancelQuestion: string;
  todosTitle: string;
  queueTitle: string;
  steerNow: string;
  steerAll: string;
  removeItem: string;
  dropTitle: string;
  dropHint: string;
  directoryUnsupported: string;
  fileTooLarge: string;
  uploadingBadge: string;
  placeholderIdle: string;
  placeholderBusyQueue: string;
  placeholderBusySteer: string;
  attachEditor: string;
  attachFile: string;
  enterModeQueue: string;
  enterModeSteer: string;
  send: string;
  queue: string;
  steer: string;
  stop: string;
}

const STRINGS_EN: WebviewStrings = {
  connected: "Connected",
  connecting: "Connecting...",
  disconnected: "Offline",
  error: "Connection Error",
  reconnect: "Reconnect",
  newSession: "New Session",
  noSessions: "New conversation",
  noModel: "Default model",
  presetReadOnly: "Read-only",
  presetDefault: "Standard",
  presetFull: "Full access",
  emptyTitle: "RingKo IDE Harness",
  emptySubtitle: "Shared sessions with CLI & WebUI. Paste screenshots, drop files, reference active code, or steer running turns.",
  quickMention: "@ Active File",
  quickExplain: "Explain Selection",
  quickFix: "Fix File Diagnostics",
  quickTerminal: "Open TUI",
  quickWebUi: "Open WebUI",
  roleUser: "You",
  roleModel: "Model Reply",
  steeredBadge: "Steered",
  pendingSteerBadge: "Pending Steer · Next Step",
  reasoningLabel: "Thinking",
  toolRunning: "Running",
  toolFailed: "Error",
  toolDone: "Done",
  copyCode: "Copy",
  copiedCode: "Copied",
  approvalTitle: "Permission Required",
  allowOnce: "Allow Once",
  allowSession: "Session",
  allowAlways: "Always",
  deny: "Deny",
  questionTitle: "Clarification Requested",
  customAnswerPlaceholder: "Optional custom note...",
  submitAnswer: "Submit",
  cancelQuestion: "Skip",
  todosTitle: "Tasks",
  queueTitle: "Queued Follow-ups",
  steerNow: "Steer",
  steerAll: "Steer All",
  removeItem: "Remove",
  dropTitle: "Drop files or images to attach",
  dropHint: "Up to 16 files · Max 20 MiB each",
  directoryUnsupported: "Folder drops are not supported. Drop individual files instead.",
  fileTooLarge: "File exceeds the 20 MiB upload limit.",
  uploadingBadge: "Uploading...",
  placeholderIdle: "Ask RingKo, @file, paste screenshot (Ctrl+V), or drop files...",
  placeholderBusyQueue: "Enter queues follow-up · Ctrl+Enter steers immediately...",
  placeholderBusySteer: "Enter steers immediately · Ctrl+Enter queues follow-up...",
  attachEditor: "@File",
  attachFile: "Attach",
  enterModeQueue: "Enter: Queue",
  enterModeSteer: "Enter: Steer",
  send: "Send",
  queue: "Queue",
  steer: "Steer",
  stop: "Stop",
};

const STRINGS_ZH: WebviewStrings = {
  connected: "已连接",
  connecting: "连接中...",
  disconnected: "离线",
  error: "连接异常",
  reconnect: "重连",
  newSession: "新建会话",
  noSessions: "新对话",
  noModel: "默认模型",
  presetReadOnly: "只读模式",
  presetDefault: "标准权限",
  presetFull: "完全访问",
  emptyTitle: "RingKo IDE 智能体面板",
  emptySubtitle: "与 TUI 及 WebUI 实时共享同一后端会话。支持粘贴截图、拖拽文件、引用当前编辑器选区及运行中插话。",
  quickMention: "@ 当前文件",
  quickExplain: "解释选中代码",
  quickFix: "修复当前诊断",
  quickTerminal: "打开 TUI",
  quickWebUi: "打开 WebUI",
  roleUser: "用户",
  roleModel: "模型回复",
  steeredBadge: "已插话",
  pendingSteerBadge: "等待下一步边界插入",
  reasoningLabel: "思考过程",
  toolRunning: "执行中",
  toolFailed: "失败",
  toolDone: "完成",
  copyCode: "复制",
  copiedCode: "已复制",
  approvalTitle: "需要工具授权",
  allowOnce: "仅本次",
  allowSession: "本会话允许",
  allowAlways: "始终允许",
  deny: "拒绝",
  questionTitle: "需要确认问题",
  customAnswerPlaceholder: "补充说明（可选）...",
  submitAnswer: "提交回答",
  cancelQuestion: "跳过",
  todosTitle: "任务进度",
  queueTitle: "排队待发消息",
  steerNow: "插话发送",
  steerAll: "全部插话",
  removeItem: "移除",
  dropTitle: "松开以添加图片或文件附件",
  dropHint: "最多 16 个文件 · 单文件上限 20 MiB",
  directoryUnsupported: "暂不支持直接拖拽文件夹，请拖入具体文件。",
  fileTooLarge: "文件超过 20 MiB 大小限制。",
  uploadingBadge: "上传中...",
  placeholderIdle: "输入问题、引用代码、粘贴截图 (Ctrl+V) 或拖入文件...",
  placeholderBusyQueue: "Enter 加入队列 · Ctrl+Enter 立即插话发送...",
  placeholderBusySteer: "Enter 立即插话发送 · Ctrl+Enter 加入队列...",
  attachEditor: "@当前文件",
  attachFile: "附件",
  enterModeQueue: "回车: 排队",
  enterModeSteer: "回车: 插话",
  send: "发送",
  queue: "排队",
  steer: "插话",
  stop: "停止",
};

export function resolveIdeLocale(vscodeLanguage: string | undefined): IdeLocale {
  return vscodeLanguage?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

export function buildChatWebviewHtml(options: { locale: IdeLocale; nonce?: string }): string {
  const nonce = options.nonce ?? randomBytes(16).toString("base64");
  const strings = options.locale === "zh-CN" ? STRINGS_ZH : STRINGS_EN;
  const serializedStrings = escapeJsonForScript(strings);

  return `<!DOCTYPE html>
<html lang="${options.locale}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>RingKo</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --rk-bg: var(--vscode-sideBar-background, #18181b);
      --rk-surface: var(--vscode-editor-background, #1f1f23);
      --rk-border: var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
      --rk-fg: var(--vscode-foreground, #e4e4e7);
      --rk-muted: var(--vscode-descriptionForeground, #a1a1aa);
      --rk-input-bg: var(--vscode-input-background, #27272a);
      --rk-input-fg: var(--vscode-input-foreground, #f4f4f5);
      --rk-input-border: var(--vscode-input-border, rgba(128, 128, 128, 0.35));
      --rk-focus: var(--vscode-focusBorder, #3b82f6);
      --rk-btn-bg: var(--vscode-button-background, #2563eb);
      --rk-btn-fg: var(--vscode-button-foreground, #ffffff);
      --rk-btn-hover: var(--vscode-button-hoverBackground, #1d4ed8);
      --rk-sec-bg: var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.2));
      --rk-sec-fg: var(--vscode-button-secondaryForeground, #e4e4e7);
      --rk-sec-hover: var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.3));
      --rk-link: var(--vscode-textLink-foreground, #60a5fa);
      --rk-ok: var(--vscode-testing-iconPassed, #22c55e);
      --rk-warn: var(--vscode-editorWarning-foreground, #eab308);
      --rk-err: var(--vscode-errorForeground, #ef4444);
      --rk-code-bg: var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.25));
      --rk-font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      --rk-mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Consolas, monospace);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--rk-bg);
      color: var(--rk-fg);
      font-family: var(--rk-font);
      font-size: var(--vscode-font-size, 13px);
      line-height: 1.45;
    }
    #app {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
    }
    .topbar {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--rk-border);
      background: var(--rk-bg);
      flex-shrink: 0;
    }
    .topbar-row {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .conn-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--rk-muted);
      white-space: nowrap;
    }
    .conn-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--rk-muted);
    }
    .conn-dot[data-state="connected"] { background: var(--rk-ok); }
    .conn-dot[data-state="connecting"] { background: var(--rk-warn); }
    .conn-dot[data-state="error"], .conn-dot[data-state="disconnected"] { background: var(--rk-err); }
    select {
      flex: 1;
      min-width: 0;
      height: 24px;
      padding: 0 6px;
      border-radius: 4px;
      border: 1px solid var(--rk-input-border);
      background: var(--rk-input-bg);
      color: var(--rk-input-fg);
      font-family: inherit;
      font-size: 11.5px;
      outline: none;
    }
    select:focus { border-color: var(--rk-focus); }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      border-radius: 4px;
      border: 1px solid transparent;
      padding: 3px 8px;
      font-family: inherit;
      font-size: 11.5px;
      cursor: pointer;
      background: var(--rk-sec-bg);
      color: var(--rk-sec-fg);
      white-space: nowrap;
    }
    button:hover:not(:disabled) { background: var(--rk-sec-hover); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button.primary {
      background: var(--rk-btn-bg);
      color: var(--rk-btn-fg);
      font-weight: 500;
    }
    button.primary:hover:not(:disabled) { background: var(--rk-btn-hover); }
    button.danger {
      border-color: color-mix(in srgb, var(--rk-err) 45%, transparent);
      color: var(--rk-err);
      background: transparent;
    }
    button.ghost {
      background: transparent;
      color: var(--rk-muted);
      padding: 2px 6px;
    }
    button.ghost:hover:not(:disabled) {
      color: var(--rk-fg);
      background: var(--rk-sec-bg);
    }
    .banner-error {
      margin: 6px 10px 0;
      padding: 6px 8px;
      border-radius: 5px;
      border: 1px solid color-mix(in srgb, var(--rk-err) 50%, transparent);
      background: color-mix(in srgb, var(--rk-err) 12%, transparent);
      color: var(--rk-err);
      font-size: 11.5px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .transcript {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .empty-state {
      margin: auto 0;
      padding: 16px 10px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    .empty-title {
      font-size: 14px;
      font-weight: 600;
    }
    .empty-sub {
      font-size: 12px;
      color: var(--rk-muted);
      max-width: 280px;
    }
    .quick-grid {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 6px;
      margin-top: 4px;
    }
    .msg {
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid var(--rk-border);
      background: var(--rk-surface);
      word-break: break-word;
    }
    .msg[data-role="user"] {
      background: color-mix(in srgb, var(--rk-btn-bg) 12%, var(--rk-surface));
      border-color: color-mix(in srgb, var(--rk-btn-bg) 35%, var(--rk-border));
    }
    .msg[data-pending-steering="true"] {
      border-style: dashed;
      border-color: var(--rk-warn);
      background: color-mix(in srgb, var(--rk-warn) 10%, var(--rk-surface));
    }
    .msg-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      font-size: 11px;
      color: var(--rk-muted);
      font-weight: 600;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 5px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
      background: var(--rk-sec-bg);
      color: var(--rk-fg);
    }
    .badge.warn {
      background: color-mix(in srgb, var(--rk-warn) 22%, transparent);
      color: var(--rk-warn);
    }
    .badge.err {
      background: color-mix(in srgb, var(--rk-err) 22%, transparent);
      color: var(--rk-err);
    }
    .badge.ok {
      background: color-mix(in srgb, var(--rk-ok) 22%, transparent);
      color: var(--rk-ok);
    }
    .msg-body {
      font-size: 12.5px;
      white-space: pre-wrap;
    }
    .msg-body p { margin: 0 0 6px; }
    .msg-body p:last-child { margin-bottom: 0; }
    .inline-code {
      font-family: var(--rk-mono);
      font-size: 11.5px;
      padding: 1px 4px;
      border-radius: 3px;
      background: var(--rk-code-bg);
    }
    .file-link {
      display: inline;
      padding: 0 3px;
      border-radius: 3px;
      border: none;
      background: color-mix(in srgb, var(--rk-link) 15%, transparent);
      color: var(--rk-link);
      font-family: var(--rk-mono);
      font-size: 11.5px;
      cursor: pointer;
    }
    .file-link:hover { text-decoration: underline; }
    .code-block {
      margin: 6px 0;
      border-radius: 5px;
      border: 1px solid var(--rk-border);
      background: var(--rk-code-bg);
      overflow: hidden;
      white-space: normal;
    }
    .code-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 3px 8px;
      font-size: 10.5px;
      color: var(--rk-muted);
      border-bottom: 1px solid var(--rk-border);
    }
    .code-block pre {
      margin: 0;
      padding: 8px;
      overflow-x: auto;
      font-family: var(--rk-mono);
      font-size: 11.5px;
      white-space: pre;
    }
    details.reasoning, details.tool-card {
      border-radius: 5px;
      border: 1px solid var(--rk-border);
      background: color-mix(in srgb, var(--rk-bg) 65%, var(--rk-surface));
      padding: 4px 8px;
      font-size: 11.5px;
    }
    details summary {
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      color: var(--rk-muted);
      user-select: none;
    }
    details pre {
      margin: 6px 0 2px;
      padding: 6px;
      border-radius: 4px;
      background: var(--rk-code-bg);
      overflow-x: auto;
      font-family: var(--rk-mono);
      font-size: 11px;
      max-height: 200px;
      white-space: pre-wrap;
    }
    .approval-card, .question-card, .todos-card, .queue-dock {
      margin: 0 10px 6px;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid var(--rk-border);
      background: var(--rk-surface);
      flex-shrink: 0;
    }
    .approval-card {
      border-color: color-mix(in srgb, var(--rk-warn) 55%, var(--rk-border));
    }
    .card-title {
      font-size: 11.5px;
      font-weight: 600;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .card-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 6px;
    }
    .queue-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 4px 0;
      border-top: 1px solid var(--rk-border);
      font-size: 11.5px;
    }
    .queue-item:first-of-type { border-top: none; }
    .queue-text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .todo-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--rk-muted);
      padding: 1px 0;
    }
    .todo-row[data-status="completed"] { text-decoration: line-through; opacity: 0.7; }
    .todo-row[data-status="in_progress"] { color: var(--rk-fg); font-weight: 500; }
    .composer {
      padding: 8px 10px 10px;
      border-top: 1px solid var(--rk-border);
      background: var(--rk-bg);
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }
    .attachments-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .att-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--rk-border);
      background: var(--rk-surface);
      font-size: 11px;
      max-width: 180px;
    }
    .att-chip img {
      width: 20px;
      height: 20px;
      object-fit: cover;
      border-radius: 2px;
    }
    .att-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    textarea {
      width: 100%;
      min-height: 58px;
      max-height: 180px;
      resize: vertical;
      padding: 7px 8px;
      border-radius: 5px;
      border: 1px solid var(--rk-input-border);
      background: var(--rk-input-bg);
      color: var(--rk-input-fg);
      font-family: inherit;
      font-size: 12.5px;
      line-height: 1.4;
      outline: none;
    }
    textarea:focus { border-color: var(--rk-focus); }
    .composer-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      flex-wrap: wrap;
    }
    .composer-left, .composer-right {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .drop-overlay {
      position: absolute;
      inset: 6px;
      z-index: 50;
      border-radius: 8px;
      border: 2px dashed var(--rk-focus);
      background: color-mix(in srgb, var(--rk-bg) 88%, transparent);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      pointer-events: none;
      text-align: center;
    }
    .drop-overlay[data-active="true"] { display: flex; }
    .q-option {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      font-size: 11.5px;
      margin: 3px 0;
      cursor: pointer;
    }
    .q-input {
      width: 100%;
      margin-top: 4px;
      padding: 4px 6px;
      border-radius: 4px;
      border: 1px solid var(--rk-input-border);
      background: var(--rk-input-bg);
      color: var(--rk-input-fg);
      font-family: inherit;
      font-size: 11.5px;
    }
  </style>
</head>
<body>
  <div id="app">
    <div id="drop-overlay" class="drop-overlay" data-active="false">
      <strong id="drop-title"></strong>
      <span id="drop-hint" style="font-size:11px;color:var(--rk-muted)"></span>
    </div>

    <div class="topbar">
      <div class="topbar-row">
        <span class="conn-pill">
          <span id="conn-dot" class="conn-dot" data-state="disconnected"></span>
          <span id="conn-label"></span>
        </span>
        <select id="session-select" aria-label="Session"></select>
        <button id="btn-new-session" type="button" title="New Session">+</button>
      </div>
      <div class="topbar-row">
        <select id="model-select" aria-label="Model"></select>
        <select id="preset-select" aria-label="Permissions" style="max-width:112px"></select>
      </div>
    </div>

    <div id="error-banner" class="banner-error" style="display:none">
      <span id="error-text"></span>
      <button id="btn-reconnect" type="button"></button>
    </div>

    <div id="transcript" class="transcript"></div>

    <div id="todos-zone"></div>
    <div id="approvals-zone"></div>
    <div id="questions-zone"></div>
    <div id="queue-zone"></div>

    <div class="composer">
      <div id="attachments-row" class="attachments-row" style="display:none"></div>
      <textarea id="draft-input" rows="3"></textarea>
      <input id="file-picker" type="file" multiple style="display:none" />
      <div class="composer-bar">
        <div class="composer-left">
          <button id="btn-attach-editor" type="button" class="ghost"></button>
          <button id="btn-attach-file" type="button" class="ghost"></button>
          <button id="btn-enter-mode" type="button" class="ghost"></button>
        </div>
        <div class="composer-right">
          <button id="btn-secondary-send" type="button" style="display:none"></button>
          <button id="btn-stop" type="button" class="danger" style="display:none"></button>
          <button id="btn-primary-send" type="button" class="primary"></button>
        </div>
      </div>
    </div>
  </div>

  <script id="ringko-i18n" type="application/json" nonce="${nonce}">${serializedStrings}</script>
  <script nonce="${nonce}">
    (() => {
      const vscode = acquireVsCodeApi();
      const t = JSON.parse(document.getElementById("ringko-i18n").textContent);

      const MAX_FILES = 16;
      const MAX_FILE_BYTES = 20 * 1024 * 1024;

      let currentState = null;
      let localToastError = null;
      let dragDepth = 0;

      const elDropOverlay = document.getElementById("drop-overlay");
      const elConnDot = document.getElementById("conn-dot");
      const elConnLabel = document.getElementById("conn-label");
      const elSessionSelect = document.getElementById("session-select");
      const elModelSelect = document.getElementById("model-select");
      const elPresetSelect = document.getElementById("preset-select");
      const elErrorBanner = document.getElementById("error-banner");
      const elErrorText = document.getElementById("error-text");
      const elBtnReconnect = document.getElementById("btn-reconnect");
      const elTranscript = document.getElementById("transcript");
      const elTodosZone = document.getElementById("todos-zone");
      const elApprovalsZone = document.getElementById("approvals-zone");
      const elQuestionsZone = document.getElementById("questions-zone");
      const elQueueZone = document.getElementById("queue-zone");
      const elAttachmentsRow = document.getElementById("attachments-row");
      const elDraft = document.getElementById("draft-input");
      const elFilePicker = document.getElementById("file-picker");
      const elBtnNewSession = document.getElementById("btn-new-session");
      const elBtnAttachEditor = document.getElementById("btn-attach-editor");
      const elBtnAttachFile = document.getElementById("btn-attach-file");
      const elBtnEnterMode = document.getElementById("btn-enter-mode");
      const elBtnSecondary = document.getElementById("btn-secondary-send");
      const elBtnStop = document.getElementById("btn-stop");
      const elBtnPrimary = document.getElementById("btn-primary-send");

      document.getElementById("drop-title").textContent = t.dropTitle;
      document.getElementById("drop-hint").textContent = t.dropHint;
      elBtnReconnect.textContent = t.reconnect;
      elBtnNewSession.title = t.newSession;
      elBtnAttachEditor.textContent = t.attachEditor;
      elBtnAttachFile.textContent = t.attachFile;
      elBtnStop.textContent = t.stop;

      const persisted = vscode.getState() || {};
      if (typeof persisted.draft === "string") {
        elDraft.value = persisted.draft;
      }

      function saveDraftState() {
        vscode.setState({ draft: elDraft.value });
      }

      function esc(raw) {
        return String(raw ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function formatInlineRichText(escapedLine) {
        let out = escapedLine.replace(/\`([^\`]+)\`/g, '<span class="inline-code">$1</span>');
        out = out.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
        out = out.replace(
          /(^|\\s)(@(?:&quot;[^&]+&quot;|[A-Za-z0-9_./-]+(?:#L\\d+(?:-L?\\d+)?)?))/g,
          (_, lead, token) => {
            const unquoted = token.replaceAll("&quot;", '"');
            return lead + '<button type="button" class="file-link" data-file-ref="' + esc(unquoted) + '">' + token + "</button>";
          }
        );
        return out;
      }

      function renderMarkdownSafe(raw) {
        const text = String(raw ?? "");
        if (!text) return "";
        const segments = text.split(/(\`\`\`[\\s\\S]*?\`\`\`)/g);
        let html = "";
        for (const seg of segments) {
          if (seg.startsWith("\`\`\`") && seg.endsWith("\`\`\`")) {
            const inner = seg.slice(3, -3);
            const nl = inner.indexOf("\\n");
            const lang = nl >= 0 ? inner.slice(0, nl).trim() : "";
            const code = nl >= 0 ? inner.slice(nl + 1) : inner;
            html +=
              '<div class="code-block">' +
                '<div class="code-head"><span>' + esc(lang || "code") + '</span>' +
                '<button type="button" class="ghost" data-copy-code="' + esc(code) + '">' + esc(t.copyCode) + '</button></div>' +
                '<pre><code>' + esc(code) + '</code></pre>' +
              '</div>';
          } else if (seg) {
            const escaped = esc(seg);
            html += formatInlineRichText(escaped);
          }
        }
        return html;
      }

      function isNearBottom() {
        return elTranscript.scrollHeight - elTranscript.scrollTop - elTranscript.clientHeight < 64;
      }

      function render(state) {
        const stickBottom = isNearBottom();
        currentState = state;

        elConnDot.setAttribute("data-state", state.connection.state);
        elConnLabel.textContent =
          state.connection.state === "connected" ? t.connected
          : state.connection.state === "connecting" ? t.connecting
          : state.connection.state === "error" ? t.error
          : t.disconnected;

        // Sessions dropdown
        elSessionSelect.innerHTML = "";
        if (!state.sessions || state.sessions.length === 0) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = t.noSessions;
          elSessionSelect.appendChild(opt);
        } else {
          for (const s of state.sessions) {
            const opt = document.createElement("option");
            opt.value = s.id;
            opt.textContent = (s.busy ? "● " : "") + s.title;
            if (s.id === state.sessionId) opt.selected = true;
            elSessionSelect.appendChild(opt);
          }
        }

        // Models dropdown
        elModelSelect.innerHTML = "";
        if (!state.models || state.models.length === 0) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = state.modelId || t.noModel;
          elModelSelect.appendChild(opt);
        } else {
          for (const m of state.models) {
            const opt = document.createElement("option");
            opt.value = m.id;
            opt.textContent = m.label;
            if (m.id === state.modelId) opt.selected = true;
            elModelSelect.appendChild(opt);
          }
        }

        // Permission preset dropdown
        const presets = [
          ["read-only", t.presetReadOnly],
          ["default", t.presetDefault],
          ["full-access", t.presetFull],
        ];
        elPresetSelect.innerHTML = "";
        for (const [val, label] of presets) {
          const opt = document.createElement("option");
          opt.value = val;
          opt.textContent = label;
          if (val === state.permissionPreset) opt.selected = true;
          elPresetSelect.appendChild(opt);
        }
        elPresetSelect.disabled = state.busy;

        // Error banner
        const activeErr = localToastError || state.error;
        if (activeErr) {
          elErrorBanner.style.display = "flex";
          elErrorText.textContent = activeErr;
        } else {
          elErrorBanner.style.display = "none";
        }

        // Transcript
        if ((!state.messages || state.messages.length === 0) && (!state.pendingSteers || state.pendingSteers.length === 0)) {
          elTranscript.innerHTML =
            '<div class="empty-state">' +
              '<div class="empty-title">' + esc(t.emptyTitle) + '</div>' +
              '<div class="empty-sub">' + esc(t.emptySubtitle) + '</div>' +
              '<div class="quick-grid">' +
                '<button type="button" data-quick="attachActiveEditor">' + esc(t.quickMention) + '</button>' +
                '<button type="button" data-quick="explainSelection">' + esc(t.quickExplain) + '</button>' +
                '<button type="button" data-quick="fixDiagnostics">' + esc(t.quickFix) + '</button>' +
                '<button type="button" data-quick="openTerminal">' + esc(t.quickTerminal) + '</button>' +
                '<button type="button" data-quick="openWebUi">' + esc(t.quickWebUi) + '</button>' +
              '</div>' +
            '</div>';
        } else {
          let html = "";
          for (const msg of state.messages) {
            const isUser = msg.role === "user";
            const roleLabel = isUser ? t.roleUser : t.roleModel;
            let badgeHtml = "";
            if (msg.steered) badgeHtml = '<span class="badge warn">' + esc(t.steeredBadge) + '</span>';
            else if (msg.streaming) badgeHtml = '<span class="badge">' + esc(t.toolRunning) + '</span>';

            html += '<div class="msg" data-role="' + esc(msg.role) + '">';
            html += '<div class="msg-head"><span>' + esc(roleLabel) + '</span>' + badgeHtml + '</div>';

            if (msg.reasoning) {
              html +=
                '<details class="reasoning"' + (msg.streaming && !msg.content ? " open" : "") + '>' +
                  '<summary><span>' + esc(t.reasoningLabel) + '</span></summary>' +
                  '<pre>' + esc(msg.reasoning) + '</pre>' +
                '</details>';
            }

            if (msg.content) {
              html += '<div class="msg-body">' + renderMarkdownSafe(msg.content) + '</div>';
            }

            if (msg.toolCalls && msg.toolCalls.length > 0) {
              for (const call of msg.toolCalls) {
                const statusClass = call.running ? "warn" : call.failed ? "err" : "ok";
                const statusText = call.running ? t.toolRunning : call.failed ? t.toolFailed : t.toolDone;
                html +=
                  '<details class="tool-card">' +
                    '<summary>' +
                      '<span><code>' + esc(call.name) + '</code></span>' +
                      '<span class="badge ' + statusClass + '">' + esc(statusText) + '</span>' +
                    '</summary>' +
                    (call.argsText ? '<pre>' + esc(call.argsText) + '</pre>' : '') +
                    (call.resultText ? '<pre>' + esc(call.resultText) + '</pre>' : '') +
                  '</details>';
              }
            }
            html += '</div>';
          }

          if (state.pendingSteers && state.pendingSteers.length > 0) {
            for (const steer of state.pendingSteers) {
              html +=
                '<div class="msg" data-role="user" data-pending-steering="true">' +
                  '<div class="msg-head"><span>' + esc(t.roleUser) + '</span><span class="badge warn">' + esc(t.pendingSteerBadge) + '</span></div>' +
                  '<div class="msg-body">' + renderMarkdownSafe(steer.content) + '</div>' +
                '</div>';
            }
          }
          elTranscript.innerHTML = html;
          if (stickBottom) {
            elTranscript.scrollTop = elTranscript.scrollHeight;
          }
        }

        // Todos
        if (state.todos && state.todos.length > 0) {
          let todoHtml = '<div class="todos-card"><div class="card-title"><span>' + esc(t.todosTitle) + '</span></div>';
          for (const item of state.todos) {
            const mark = item.status === "completed" ? "✓" : item.status === "in_progress" ? "▸" : "○";
            todoHtml += '<div class="todo-row" data-status="' + esc(item.status) + '"><span>' + mark + '</span><span>' + esc(item.content) + '</span></div>';
          }
          todoHtml += '</div>';
          elTodosZone.innerHTML = todoHtml;
        } else {
          elTodosZone.innerHTML = "";
        }

        // Approvals
        if (state.approvals && state.approvals.length > 0) {
          let appHtml = "";
          for (const ap of state.approvals) {
            appHtml +=
              '<div class="approval-card">' +
                '<div class="card-title">' +
                  '<span>' + esc(t.approvalTitle) + ': <code>' + esc(ap.toolName) + '</code></span>' +
                  '<span class="badge warn">' + esc(ap.riskLevel) + '</span>' +
                '</div>' +
                '<div style="font-size:11.5px;color:var(--rk-muted)">' + esc(ap.reason) + (ap.target ? " · <code>" + esc(ap.target) + "</code>" : "") + '</div>' +
                '<div class="card-actions">' +
                  '<button type="button" class="primary" data-approval-id="' + esc(ap.id) + '" data-approved="true">' + esc(t.allowOnce) + '</button>' +
                  '<button type="button" data-approval-id="' + esc(ap.id) + '" data-approved="true" data-scope="session">' + esc(t.allowSession) + '</button>' +
                  '<button type="button" data-approval-id="' + esc(ap.id) + '" data-approved="true" data-scope="saved">' + esc(t.allowAlways) + '</button>' +
                  '<button type="button" class="danger" data-approval-id="' + esc(ap.id) + '" data-approved="false">' + esc(t.deny) + '</button>' +
                '</div>' +
              '</div>';
          }
          elApprovalsZone.innerHTML = appHtml;
        } else {
          elApprovalsZone.innerHTML = "";
        }

        // Questions
        if (state.questions && state.questions.length > 0) {
          let qHtml = "";
          for (const req of state.questions) {
            qHtml += '<div class="question-card" data-question-card="' + esc(req.id) + '">';
            qHtml += '<div class="card-title"><span>' + esc(t.questionTitle) + '</span></div>';
            for (const q of req.input.questions) {
              const inputType = q.multiSelect ? "checkbox" : "radio";
              qHtml += '<div style="margin-top:6px" data-q-item="' + esc(q.id) + '">';
              qHtml += '<div style="font-size:12px;font-weight:500">' + esc(q.question) + '</div>';
              if (q.options && q.options.length > 0) {
                for (const opt of q.options) {
                  qHtml +=
                    '<label class="q-option">' +
                      '<input type="' + inputType + '" name="q-' + esc(req.id) + '-' + esc(q.id) + '" value="' + esc(opt.label) + '" />' +
                      '<span>' + esc(opt.label) + (opt.description ? ' <span style="color:var(--rk-muted)">— ' + esc(opt.description) + '</span>' : '') + '</span>' +
                    '</label>';
                }
              }
              qHtml += '<input type="text" class="q-input" data-q-custom="' + esc(q.id) + '" placeholder="' + esc(t.customAnswerPlaceholder) + '" />';
              qHtml += '</div>';
            }
            qHtml +=
              '<div class="card-actions">' +
                '<button type="button" class="primary" data-submit-question="' + esc(req.id) + '">' + esc(t.submitAnswer) + '</button>' +
                '<button type="button" data-cancel-question="' + esc(req.id) + '">' + esc(t.cancelQuestion) + '</button>' +
              '</div>';
            qHtml += '</div>';
          }
          elQuestionsZone.innerHTML = qHtml;
        } else {
          elQuestionsZone.innerHTML = "";
        }

        // Queue dock
        if (state.queue && state.queue.length > 0) {
          let qDock = '<div class="queue-dock"><div class="card-title"><span>' + esc(t.queueTitle) + ' (' + state.queue.length + ')</span>';
          if (state.busy && state.queue.length > 1) {
            qDock += '<button type="button" class="ghost" data-steer-all="true">' + esc(t.steerAll) + '</button>';
          }
          qDock += '</div>';
          for (const item of state.queue) {
            qDock +=
              '<div class="queue-item">' +
                '<span class="queue-text">' + esc(item.prompt) + '</span>' +
                '<div style="display:flex;gap:4px">' +
                  (state.busy ? '<button type="button" data-steer-queued="' + esc(item.id) + '">' + esc(t.steerNow) + '</button>' : '') +
                  '<button type="button" class="ghost" data-remove-queued="' + esc(item.id) + '">×</button>' +
                '</div>' +
              '</div>';
          }
          qDock += '</div>';
          elQueueZone.innerHTML = qDock;
        } else {
          elQueueZone.innerHTML = "";
        }

        // Attachments row
        if ((state.attachments && state.attachments.length > 0) || state.uploadingCount > 0) {
          elAttachmentsRow.style.display = "flex";
          let attHtml = "";
          for (const att of state.attachments || []) {
            attHtml +=
              '<span class="att-chip">' +
                (att.previewDataUrl ? '<img src="' + esc(att.previewDataUrl) + '" alt="" />' : '') +
                '<span class="att-name">' + esc(att.name) + '</span>' +
                '<button type="button" class="ghost" data-remove-att="' + esc(att.id) + '">×</button>' +
              '</span>';
          }
          if (state.uploadingCount > 0) {
            attHtml += '<span class="badge warn">' + esc(t.uploadingBadge) + ' (' + state.uploadingCount + ')</span>';
          }
          elAttachmentsRow.innerHTML = attHtml;
        } else {
          elAttachmentsRow.style.display = "none";
          elAttachmentsRow.innerHTML = "";
        }

        // Composer controls
        const enterSteer = state.busyEnter === "steer";
        elBtnEnterMode.textContent = enterSteer ? t.enterModeSteer : t.enterModeQueue;
        elDraft.placeholder = !state.busy
          ? t.placeholderIdle
          : enterSteer
            ? t.placeholderBusySteer
            : t.placeholderBusyQueue;

        const canSubmit = state.uploadingCount === 0 && (elDraft.value.trim().length > 0 || (state.attachments && state.attachments.length > 0));
        if (state.busy) {
          elBtnPrimary.textContent = enterSteer ? t.steer : t.queue;
          elBtnPrimary.disabled = !canSubmit;
          elBtnSecondary.style.display = "inline-flex";
          elBtnSecondary.textContent = enterSteer ? t.queue : t.steer;
          elBtnSecondary.disabled = !canSubmit;
          elBtnStop.style.display = "inline-flex";
        } else {
          elBtnPrimary.textContent = t.send;
          elBtnPrimary.disabled = !canSubmit;
          elBtnSecondary.style.display = "none";
          elBtnStop.style.display = "none";
        }
      }

      function refreshComposerButtons() {
        if (!currentState) return;
        const canSubmit = currentState.uploadingCount === 0 && (elDraft.value.trim().length > 0 || (currentState.attachments && currentState.attachments.length > 0));
        elBtnPrimary.disabled = !canSubmit;
        elBtnSecondary.disabled = !canSubmit;
      }

      function dispatchComposer(mode) {
        if (!currentState || currentState.uploadingCount > 0) return;
        const prompt = elDraft.value;
        const hasAttachments = currentState.attachments && currentState.attachments.length > 0;
        if (!prompt.trim() && !hasAttachments) return;
        localToastError = null;
        vscode.postMessage({ type: mode, prompt });
        elDraft.value = "";
        saveDraftState();
        refreshComposerButtons();
      }

      function submitPrimary() {
        if (!currentState) return;
        if (!currentState.busy) {
          dispatchComposer("send");
        } else if (currentState.busyEnter === "steer") {
          dispatchComposer("steer");
        } else {
          dispatchComposer("enqueue");
        }
      }

      function submitComplementary() {
        if (!currentState) return;
        if (!currentState.busy) {
          dispatchComposer("send");
        } else if (currentState.busyEnter === "steer") {
          dispatchComposer("enqueue");
        } else {
          dispatchComposer("steer");
        }
      }

      // File intake helpers (clipboard paste + drag-and-drop + picker)
      function buildScreenshotName(mime, index) {
        const ext = (mime.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
        const iso = new Date().toISOString().replace(/[-:]/g, "").replace(/\\.\\d+Z$/, "");
        return "pasted-image-" + iso + (index > 0 ? "-" + (index + 1) : "") + "." + ext;
      }

      function readFileAsUploadPayload(file, overrideName) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = typeof reader.result === "string" ? reader.result : "";
            const comma = dataUrl.indexOf(",");
            if (comma < 0) {
              reject(new Error("Invalid file encoding."));
              return;
            }
            const base64 = dataUrl.slice(comma + 1);
            const isImage = (file.type || "").startsWith("image/") && file.size <= 1024 * 1024;
            resolve({
              name: overrideName || file.name || "attachment",
              type: file.type || "application/octet-stream",
              size: file.size,
              base64,
              ...(isImage ? { previewDataUrl: dataUrl } : {}),
            });
          };
          reader.onerror = () => reject(new Error("Failed to read file."));
          reader.readAsDataURL(file);
        });
      }

      async function ingestFiles(fileEntries) {
        if (!fileEntries || fileEntries.length === 0) return;
        const limited = fileEntries.slice(0, MAX_FILES);
        for (const item of limited) {
          if (item.file.size > MAX_FILE_BYTES) {
            localToastError = t.fileTooLarge;
            if (currentState) render(currentState);
            return;
          }
        }
        try {
          const payloads = [];
          for (const item of limited) {
            payloads.push(await readFileAsUploadPayload(item.file, item.name));
          }
          localToastError = null;
          vscode.postMessage({ type: "uploadFiles", files: payloads });
        } catch (err) {
          localToastError = err instanceof Error ? err.message : "Upload failed.";
          if (currentState) render(currentState);
        }
      }

      elDraft.addEventListener("input", () => {
        saveDraftState();
        refreshComposerButtons();
      });

      elDraft.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
        const mod = event.ctrlKey || event.metaKey;
        if (mod) {
          event.preventDefault();
          if (currentState && currentState.busy && !elDraft.value.trim() && (!currentState.attachments || currentState.attachments.length === 0) && currentState.queue && currentState.queue.length > 0) {
            vscode.postMessage({ type: "steerAllQueued" });
            return;
          }
          submitComplementary();
          return;
        }
        event.preventDefault();
        submitPrimary();
      });

      elDraft.addEventListener("paste", (event) => {
        const cd = event.clipboardData;
        if (!cd) return;
        const types = Array.from(cd.types || []);
        const hasText = types.includes("text/plain") || types.includes("text/html");
        const collected = [];
        let imgIdx = 0;
        if (cd.items && cd.items.length > 0) {
          for (const item of Array.from(cd.items)) {
            if (item.kind !== "file") continue;
            const f = item.getAsFile();
            if (!f) continue;
            collected.push({ file: f });
          }
        }
        if (collected.length === 0) return;
        // Do not hijack rich-text copy that bundles a companion bitmap alongside text.
        const allImages = collected.every(entry => (entry.file.type || "").startsWith("image/"));
        if (hasText && allImages) return;

        event.preventDefault();
        const named = collected.map(entry => {
          const rawName = (entry.file.name || "").trim();
          const generic = !rawName || /^image\\.[a-z0-9]+$/i.test(rawName);
          if (generic && (entry.file.type || "").startsWith("image/")) {
            const generated = buildScreenshotName(entry.file.type, imgIdx);
            imgIdx += 1;
            return { file: entry.file, name: generated };
          }
          return { file: entry.file, name: rawName || "attachment" };
        });
        void ingestFiles(named);
      });

      // Drag and drop on entire panel
      function hasFilesTransfer(dt) {
        return dt && Array.from(dt.types || []).includes("Files");
      }

      document.addEventListener("dragenter", (event) => {
        if (!hasFilesTransfer(event.dataTransfer)) return;
        event.preventDefault();
        dragDepth += 1;
        elDropOverlay.setAttribute("data-active", "true");
      });

      document.addEventListener("dragover", (event) => {
        if (!hasFilesTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      });

      document.addEventListener("dragleave", (event) => {
        if (!hasFilesTransfer(event.dataTransfer)) return;
        event.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) elDropOverlay.setAttribute("data-active", "false");
      });

      document.addEventListener("drop", (event) => {
        if (!hasFilesTransfer(event.dataTransfer)) return;
        event.preventDefault();
        dragDepth = 0;
        elDropOverlay.setAttribute("data-active", "false");
        const dt = event.dataTransfer;
        const entries = [];
        if (dt.items && dt.items.length > 0) {
          for (const item of Array.from(dt.items)) {
            if (item.kind !== "file") continue;
            if (typeof item.webkitGetAsEntry === "function") {
              const entry = item.webkitGetAsEntry();
              if (entry && entry.isDirectory) {
                localToastError = t.directoryUnsupported;
                if (currentState) render(currentState);
                return;
              }
            }
            const f = item.getAsFile();
            if (f) entries.push({ file: f, name: f.name });
          }
        } else if (dt.files) {
          for (const f of Array.from(dt.files)) {
            entries.push({ file: f, name: f.name });
          }
        }
        void ingestFiles(entries);
      });

      elBtnAttachFile.addEventListener("click", () => {
        elFilePicker.value = "";
        elFilePicker.click();
      });

      elFilePicker.addEventListener("change", () => {
        const files = Array.from(elFilePicker.files || []).map(f => ({ file: f, name: f.name }));
        void ingestFiles(files);
      });

      elBtnAttachEditor.addEventListener("click", () => vscode.postMessage({ type: "attachActiveEditor" }));
      elBtnNewSession.addEventListener("click", () => vscode.postMessage({ type: "newSession" }));
      elBtnReconnect.addEventListener("click", () => {
        localToastError = null;
        vscode.postMessage({ type: "reconnect" });
      });
      elBtnEnterMode.addEventListener("click", () => {
        if (!currentState) return;
        vscode.postMessage({
          type: "setBusyEnter",
          busyEnter: currentState.busyEnter === "steer" ? "queue" : "steer",
        });
      });
      elBtnPrimary.addEventListener("click", submitPrimary);
      elBtnSecondary.addEventListener("click", submitComplementary);
      elBtnStop.addEventListener("click", () => vscode.postMessage({ type: "stop" }));

      elSessionSelect.addEventListener("change", () => {
        if (elSessionSelect.value) {
          vscode.postMessage({ type: "selectSession", sessionId: elSessionSelect.value });
        }
      });

      elModelSelect.addEventListener("change", () => {
        if (elModelSelect.value) {
          vscode.postMessage({ type: "setModel", model: elModelSelect.value });
        }
      });

      elPresetSelect.addEventListener("change", () => {
        if (elPresetSelect.value) {
          vscode.postMessage({ type: "setAccessPreset", preset: elPresetSelect.value });
        }
      });

      // Delegated clicks inside dynamic zones
      document.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target.closest("button") : null;
        if (!target) return;

        const quick = target.getAttribute("data-quick");
        if (quick) {
          vscode.postMessage({ type: quick });
          return;
        }

        const fileRef = target.getAttribute("data-file-ref");
        if (fileRef) {
          vscode.postMessage({ type: "openFile", reference: fileRef });
          return;
        }

        const copyCode = target.getAttribute("data-copy-code");
        if (copyCode !== null) {
          navigator.clipboard?.writeText(copyCode).then(() => {
            target.textContent = t.copiedCode;
            setTimeout(() => { target.textContent = t.copyCode; }, 1200);
          }).catch(() => {});
          return;
        }

        const approvalId = target.getAttribute("data-approval-id");
        if (approvalId) {
          const approved = target.getAttribute("data-approved") === "true";
          const scope = target.getAttribute("data-scope") || undefined;
          vscode.postMessage({
            type: "decideApproval",
            id: approvalId,
            approved,
            ...(scope ? { scope } : {}),
          });
          return;
        }

        const submitQ = target.getAttribute("data-submit-question");
        if (submitQ) {
          const card = target.closest("[data-question-card]");
          if (!card) return;
          const answers = [];
          for (const qItem of Array.from(card.querySelectorAll("[data-q-item]"))) {
            const qId = qItem.getAttribute("data-q-item");
            const selected = Array.from(qItem.querySelectorAll("input:checked")).map(i => i.value);
            const customInput = qItem.querySelector("[data-q-custom]");
            const custom = customInput && customInput.value.trim() ? customInput.value.trim() : undefined;
            answers.push({ id: qId, selected, ...(custom ? { custom } : {}) });
          }
          vscode.postMessage({ type: "answerQuestion", id: submitQ, output: { answers } });
          return;
        }

        const cancelQ = target.getAttribute("data-cancel-question");
        if (cancelQ) {
          vscode.postMessage({ type: "answerQuestion", id: cancelQ, cancel: true });
          return;
        }

        const steerQueued = target.getAttribute("data-steer-queued");
        if (steerQueued) {
          vscode.postMessage({ type: "steerQueued", id: steerQueued });
          return;
        }

        if (target.getAttribute("data-steer-all") === "true") {
          vscode.postMessage({ type: "steerAllQueued" });
          return;
        }

        const removeQueued = target.getAttribute("data-remove-queued");
        if (removeQueued) {
          vscode.postMessage({ type: "removeQueued", id: removeQueued });
          return;
        }

        const removeAtt = target.getAttribute("data-remove-att");
        if (removeAtt) {
          vscode.postMessage({ type: "removeAttachment", id: removeAtt });
        }
      });

      window.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "state") {
          render(msg.state);
        } else if (msg.type === "insertText" && typeof msg.text === "string") {
          const cur = elDraft.value;
          const sep = cur && !cur.endsWith(" ") && !cur.endsWith("\\n") ? " " : "";
          elDraft.value = cur + sep + msg.text + " ";
          saveDraftState();
          refreshComposerButtons();
          if (msg.focus !== false) {
            elDraft.focus();
            elDraft.setSelectionRange(elDraft.value.length, elDraft.value.length);
          }
        } else if (msg.type === "toast" && typeof msg.message === "string") {
          localToastError = msg.message;
          if (currentState) render(currentState);
        }
      });

      vscode.postMessage({ type: "ready" });
    })();
  </script>
</body>
</html>`;
}
