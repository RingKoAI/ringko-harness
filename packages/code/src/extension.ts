import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import * as vscode from "vscode";
import { BackendManager, type BackendConnectionSettings } from "./backend-manager.ts";
import { ChatController } from "./chat-controller.ts";
import { RingkoChatViewProvider } from "./chat-view-provider.ts";
import {
  formatDiagnosticsPrompt,
  formatSelectionPrompt,
  normalizeRelativePath,
  resolveWorkspaceFile,
  type DiagnosticItem,
} from "./editor-context.ts";
import { resolveIdeLocale, type IdeLocale } from "./webview-html.ts";

let activeBackendManager: BackendManager | undefined;
let activeController: ChatController | undefined;

function readExtensionSettings(): BackendConnectionSettings {
  const cfg = vscode.workspace.getConfiguration("ringko");
  return {
    serverUrl: cfg.get<string>("serverUrl", "") ?? "",
    authToken: cfg.get<string>("authToken", "") ?? "",
    cliPath: cfg.get<string>("cliPath", "ringko") || "ringko",
    autoStartBackend: cfg.get<boolean>("autoStartBackend", true),
  };
}

function mapDiagnosticSeverity(severity: vscode.DiagnosticSeverity): DiagnosticItem["severity"] {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "info";
    default:
      return "hint";
  }
}

function buildNoWorkspaceHtml(locale: IdeLocale): string {
  const nonce = randomBytes(16).toString("base64");
  const title = locale === "zh-CN" ? "未打开工作区文件夹" : "No Workspace Folder Open";
  const hint = locale === "zh-CN"
    ? "请先在 VS Code 中打开一个项目文件夹以启用 RingKo 智能体面板。"
    : "Open a project folder in VS Code to activate the RingKo Agent Harness.";
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';" />
  <style nonce="${nonce}">
    body {
      margin: 0;
      padding: 24px 16px;
      font-family: var(--vscode-font-family, sans-serif);
      color: var(--vscode-descriptionForeground, #a1a1aa);
      text-align: center;
    }
    h3 { color: var(--vscode-foreground, #e4e4e7); font-size: 13.5px; margin-bottom: 6px; }
    p { font-size: 12px; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <h3>${title}</h3>
  <p>${hint}</p>
</body>
</html>`;
}

function resolveTuiShellArgs(cliPath: string, workspaceRoot: string, extensionPath: string): { shellPath: string; shellArgs: string[] } | undefined {
  const trimmed = cliPath.trim() || "ringko";
  if (trimmed.includes("\0")) return undefined;
  if (trimmed !== "ringko") {
    return { shellPath: trimmed, shellArgs: ["tui", "--workspace", workspaceRoot] };
  }
  const exeName = process.platform === "win32" ? "ringko.exe" : "ringko";
  for (const root of [workspaceRoot, resolve(extensionPath, "../..")]) {
    const distBin = join(root, "dist", exeName);
    if (existsSync(distBin)) {
      return { shellPath: distBin, shellArgs: ["tui", "--workspace", workspaceRoot] };
    }
    const cliEntry = join(root, "packages", "tui", "src", "cli.ts");
    if (existsSync(cliEntry)) {
      return { shellPath: "bun", shellArgs: [cliEntry, "tui", "--workspace", workspaceRoot] };
    }
  }
  return { shellPath: trimmed, shellArgs: ["tui", "--workspace", workspaceRoot] };
}

export function activate(context: vscode.ExtensionContext): void {
  const locale = resolveIdeLocale(vscode.env.language);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!workspaceRoot) {
    const emptyProvider: vscode.WebviewViewProvider = {
      resolveWebviewView(webviewView) {
        webviewView.webview.options = { enableScripts: false, localResourceRoots: [] };
        webviewView.webview.html = buildNoWorkspaceHtml(locale);
      },
    };
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(RingkoChatViewProvider.viewType, emptyProvider),
    );
    const warnNoWorkspace = () => {
      void vscode.window.showInformationMessage(
        locale === "zh-CN" ? "请先打开一个工作区文件夹以使用 RingKo。" : "Open a workspace folder to use RingKo.",
      );
    };
    for (const cmd of [
      "ringko.openChat",
      "ringko.newSession",
      "ringko.sendSelection",
      "ringko.explainSelection",
      "ringko.fixDiagnostics",
      "ringko.switchModel",
      "ringko.openTerminal",
      "ringko.openWebUi",
      "ringko.reconnect",
      "ringko.status",
    ]) {
      context.subscriptions.push(vscode.commands.registerCommand(cmd, warnNoWorkspace));
    }
    return;
  }

  const backend = new BackendManager({
    workspace: workspaceRoot,
    extensionPath: context.extensionPath,
    getSettings: readExtensionSettings,
  });
  activeBackendManager = backend;

  let viewProvider: RingkoChatViewProvider | undefined;

  const controller = new ChatController({
    backend,
    locale,
    onApprovalRequested: approval => {
      if (viewProvider?.isVisible()) return;
      const allowOnceLabel = locale === "zh-CN" ? "仅本次允许" : "Allow Once";
      const allowSessionLabel = locale === "zh-CN" ? "本会话允许" : "Allow Session";
      const openPanelLabel = locale === "zh-CN" ? "打开面板" : "Open Chat";
      const denyLabel = locale === "zh-CN" ? "拒绝" : "Deny";
      const promptText = locale === "zh-CN"
        ? `RingKo 请求执行 ${approval.toolName}：${approval.reason}${approval.target ? ` (${approval.target})` : ""}`
        : `RingKo wants to run ${approval.toolName}: ${approval.reason}${approval.target ? ` (${approval.target})` : ""}`;

      void vscode.window.showWarningMessage(
        promptText,
        allowOnceLabel,
        allowSessionLabel,
        openPanelLabel,
        denyLabel,
      ).then(choice => {
        if (choice === allowOnceLabel) {
          void controller.decideApproval(approval.id, true);
        } else if (choice === allowSessionLabel) {
          void controller.decideApproval(approval.id, true, "session");
        } else if (choice === openPanelLabel) {
          void viewProvider?.reveal();
        } else if (choice === denyLabel) {
          void controller.decideApproval(approval.id, false);
        }
      });
    },
  });
  activeController = controller;

  const extractEditorSelection = (): {
    relativePath: string;
    startLine: number;
    endLine: number;
    text: string;
    languageId: string;
    uri: vscode.Uri;
  } | null => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") return null;
    const relativePath = normalizeRelativePath(workspaceRoot, editor.document.uri.fsPath);
    if (!relativePath) return null;
    const sel = editor.selection;
    const hasSelection = !sel.isEmpty;
    const startLine = sel.start.line + 1;
    const endLine = hasSelection && sel.end.character === 0 && sel.end.line > sel.start.line
      ? sel.end.line
      : sel.end.line + 1;
    return {
      relativePath,
      startLine: hasSelection ? startLine : 0,
      endLine: hasSelection ? endLine : 0,
      text: hasSelection ? editor.document.getText(sel) : "",
      languageId: editor.document.languageId,
      uri: editor.document.uri,
    };
  };

  const attachActiveEditor = async (): Promise<void> => {
    const active = extractEditorSelection();
    if (!active) {
      void vscode.window.showInformationMessage(
        locale === "zh-CN" ? "请先聚焦一个工作区内的编辑器文件。" : "Focus a file inside the workspace first.",
      );
      return;
    }
    const mention = formatSelectionPrompt(
      "mention",
      active.relativePath,
      active.startLine > 0 ? { startLine: active.startLine, endLine: active.endLine } : undefined,
      locale,
    );
    await viewProvider?.insertText(mention);
  };

  const explainSelection = async (): Promise<void> => {
    const active = extractEditorSelection();
    if (!active) {
      void vscode.window.showInformationMessage(
        locale === "zh-CN" ? "请先在工作区文件中选中一段代码。" : "Select code in a workspace file first.",
      );
      return;
    }
    const prompt = formatSelectionPrompt(
      "explain",
      active.relativePath,
      {
        startLine: active.startLine || 1,
        endLine: active.endLine || active.startLine || 1,
        text: active.text,
        languageId: active.languageId,
      },
      locale,
    );
    await viewProvider?.reveal();
    await controller.sendOrEnqueue(prompt);
  };

  const fixDiagnostics = async (): Promise<void> => {
    const active = extractEditorSelection();
    if (!active) {
      void vscode.window.showInformationMessage(
        locale === "zh-CN" ? "请先聚焦一个需要修复的工作区文件。" : "Focus a workspace file to inspect diagnostics.",
      );
      return;
    }
    const rawDiagnostics = vscode.languages.getDiagnostics(active.uri)
      .filter(d => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning);
    const mapped: DiagnosticItem[] = rawDiagnostics.map(d => ({
      line: d.range.start.line + 1,
      column: d.range.start.character + 1,
      severity: mapDiagnosticSeverity(d.severity),
      message: d.message,
      ...(d.source ? { source: d.source } : {}),
      ...(typeof d.code === "string" || typeof d.code === "number"
        ? { code: d.code }
        : typeof d.code === "object" && d.code !== null && "value" in d.code
          ? { code: d.code.value }
          : {}),
    }));
    const prompt = formatDiagnosticsPrompt(active.relativePath, mapped, locale);
    await viewProvider?.reveal();
    await controller.sendOrEnqueue(prompt);
  };

  const openFileReference = async (reference: string): Promise<void> => {
    const resolved = resolveWorkspaceFile(workspaceRoot, reference);
    if (!resolved) {
      void vscode.window.showWarningMessage(
        locale === "zh-CN" ? `无法在当前工作区内打开路径：${reference}` : `Cannot open path outside workspace: ${reference}`,
      );
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved.absolutePath));
    const startLineZero = Math.max(0, (resolved.line ?? 1) - 1);
    const endLineZero = Math.max(startLineZero, (resolved.endLine ?? resolved.line ?? 1) - 1);
    const startColZero = Math.max(0, (resolved.column ?? 1) - 1);
    const selection = new vscode.Range(startLineZero, startColZero, endLineZero, startColZero);
    await vscode.window.showTextDocument(doc, {
      preview: true,
      selection: resolved.line !== undefined ? selection : undefined,
    });
  };

  const openWebUi = async (): Promise<void> => {
    try {
      const url = await backend.ensureWebUiUrl();
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : "Failed to open RingKo WebUI.",
      );
    }
  };

  const openTerminal = async (): Promise<void> => {
    const settings = readExtensionSettings();
    const launch = resolveTuiShellArgs(settings.cliPath, workspaceRoot, context.extensionPath);
    if (!launch) {
      void vscode.window.showErrorMessage("Invalid ringko.cliPath configuration.");
      return;
    }
    const terminal = vscode.window.createTerminal({
      name: "RingKo TUI",
      cwd: workspaceRoot,
      shellPath: launch.shellPath,
      shellArgs: launch.shellArgs,
      location: { viewColumn: vscode.ViewColumn.Beside },
    });
    terminal.show();
  };

  viewProvider = new RingkoChatViewProvider(controller, locale, {
    onAttachActiveEditor: attachActiveEditor,
    onExplainSelection: explainSelection,
    onFixDiagnostics: fixDiagnostics,
    onOpenFile: openFileReference,
    onOpenWebUi: openWebUi,
    onOpenTerminal: openTerminal,
  });

  // Status bar item
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "ringko.status";
  const updateStatusBar = () => {
    const st = controller.getState();
    if (st.connection.state === "connecting") {
      statusBar.text = "$(sync~spin) RingKo";
      statusBar.tooltip = locale === "zh-CN" ? "RingKo：正在连接后端..." : "RingKo: Connecting to backend...";
    } else if (st.connection.state === "connected") {
      statusBar.text = st.busy ? "$(loading~spin) RingKo" : "$(hubot) RingKo";
      statusBar.tooltip = `${st.connection.url ?? "RingKo"}${st.modelId ? ` · ${st.modelId}` : ""}`;
    } else {
      statusBar.text = "$(warning) RingKo";
      statusBar.tooltip = st.connection.error ?? (locale === "zh-CN" ? "RingKo：未连接（点击查看状态）" : "RingKo: Disconnected (click for status)");
    }
  };
  updateStatusBar();
  statusBar.show();

  const unsubStatus = controller.subscribe(() => updateStatusBar());

  const configSub = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration("ringko")) {
      void controller.reconnect();
    }
  });

  context.subscriptions.push(
    viewProvider,
    statusBar,
    { dispose: unsubStatus },
    configSub,
    vscode.window.registerWebviewViewProvider(RingkoChatViewProvider.viewType, viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("ringko.openChat", async () => {
      await viewProvider?.reveal();
    }),
    vscode.commands.registerCommand("ringko.newSession", async () => {
      await viewProvider?.reveal();
      await controller.createNewSession();
    }),
    vscode.commands.registerCommand("ringko.sendSelection", attachActiveEditor),
    vscode.commands.registerCommand("ringko.explainSelection", explainSelection),
    vscode.commands.registerCommand("ringko.fixDiagnostics", fixDiagnostics),
    vscode.commands.registerCommand("ringko.switchModel", async () => {
      await controller.initialize();
      const st = controller.getState();
      if (st.models.length === 0) {
        void vscode.window.showInformationMessage(
          locale === "zh-CN" ? "当前后端尚未配置可用模型，请先在 WebUI 或 TUI 中配置提供商。" : "No models configured yet. Configure providers in WebUI or TUI first.",
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(
        st.models.map(m => ({
          label: m.label,
          description: m.id === st.modelId ? (locale === "zh-CN" ? "当前模型" : "Active") : undefined,
          id: m.id,
        })),
        { placeHolder: locale === "zh-CN" ? "选择要切换的模型" : "Select active RingKo model" },
      );
      if (picked) {
        await controller.setModel(picked.id);
      }
    }),
    vscode.commands.registerCommand("ringko.openTerminal", openTerminal),
    vscode.commands.registerCommand("ringko.openWebUi", openWebUi),
    vscode.commands.registerCommand("ringko.reconnect", async () => {
      await controller.reconnect();
    }),
    vscode.commands.registerCommand("ringko.status", async () => {
      try {
        const runtime = await backend.fetchRuntimeStatus();
        const conn = backend.getStatus();
        const items: vscode.QuickPickItem[] = [
          {
            label: "$(plug) Backend",
            description: `${conn.state} ${conn.url ? `(${conn.url})` : ""}`,
          },
          ...runtime.entries.map(entry => ({
            label: entry.label,
            description: entry.value,
          })),
        ];
        await vscode.window.showQuickPick(items, {
          title: `RingKo Status${runtime.version ? ` v${runtime.version}` : ""}`,
          placeHolder: locale === "zh-CN" ? "共享后端诊断概览" : "Shared backend runtime diagnostics",
        });
      } catch (error) {
        const reconnectAction = locale === "zh-CN" ? "重新连接" : "Reconnect";
        const choice = await vscode.window.showWarningMessage(
          error instanceof Error ? error.message : "Backend is disconnected.",
          reconnectAction,
        );
        if (choice === reconnectAction) {
          await controller.reconnect();
        }
      }
    }),
  );

  // Kick off background connection without blocking VS Code extension activation.
  void controller.initialize();
}

export async function deactivate(): Promise<void> {
  const controller = activeController;
  const backend = activeBackendManager;
  activeController = undefined;
  activeBackendManager = undefined;
  controller?.dispose();
  await backend?.dispose();
}
