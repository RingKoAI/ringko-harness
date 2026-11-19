import * as vscode from "vscode";
import type { ChatController } from "./chat-controller.ts";
import { buildChatWebviewHtml, type IdeLocale } from "./webview-html.ts";
import { parseWebviewMessage, type HostToWebviewMessage } from "./webview-protocol.ts";

export interface ChatViewHostActions {
  onAttachActiveEditor: () => Promise<void>;
  onExplainSelection: () => Promise<void>;
  onFixDiagnostics: () => Promise<void>;
  onOpenFile: (reference: string) => Promise<void>;
  onOpenWebUi: () => Promise<void>;
  onOpenTerminal: () => Promise<void>;
}

export class RingkoChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "ringko.chatView";

  private readonly controller: ChatController;
  private readonly locale: IdeLocale;
  private readonly actions: ChatViewHostActions;
  private readonly unsubscribeController: () => void;

  private view: vscode.WebviewView | undefined;
  private webviewReady = false;
  private pendingInsertions: string[] = [];
  private initialized = false;

  constructor(controller: ChatController, locale: IdeLocale, actions: ChatViewHostActions) {
    this.controller = controller;
    this.locale = locale;
    this.actions = actions;
    this.unsubscribeController = this.controller.subscribe(state => {
      this.postMessage({ type: "state", state });
    });
  }

  isVisible(): boolean {
    return Boolean(this.view?.visible);
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand("ringko.chatView.focus");
  }

  async insertText(text: string): Promise<void> {
    if (!text.trim()) return;
    await this.reveal();
    if (this.view && this.webviewReady) {
      this.postMessage({ type: "insertText", text, focus: true });
    } else {
      this.pendingInsertions.push(text);
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.webviewReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };
    webviewView.webview.html = buildChatWebviewHtml({ locale: this.locale });

    const messageSub = webviewView.webview.onDidReceiveMessage(raw => {
      void this.handleMessage(raw);
    });

    const disposeSub = webviewView.onDidDispose(() => {
      messageSub.dispose();
      disposeSub.dispose();
      if (this.view === webviewView) {
        this.view = undefined;
        this.webviewReady = false;
      }
    });
  }

  dispose(): void {
    this.unsubscribeController();
    this.view = undefined;
    this.webviewReady = false;
    this.pendingInsertions = [];
  }

  private postMessage(message: HostToWebviewMessage): void {
    if (!this.view || !this.webviewReady) return;
    void this.view.webview.postMessage(message);
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const parsed = parseWebviewMessage(raw);
    if (!parsed) return;

    try {
      switch (parsed.type) {
        case "ready": {
          this.webviewReady = true;
          this.postMessage({ type: "state", state: this.controller.getState() });
          if (this.pendingInsertions.length > 0) {
            const combined = this.pendingInsertions.join(" ");
            this.pendingInsertions = [];
            this.postMessage({ type: "insertText", text: combined, focus: true });
          }
          if (!this.initialized) {
            this.initialized = true;
            await this.controller.initialize();
          }
          break;
        }
        case "send":
          await this.controller.sendOrEnqueue(parsed.prompt);
          break;
        case "steer":
          await this.controller.steer(parsed.prompt);
          break;
        case "enqueue":
          this.controller.enqueue(parsed.prompt);
          break;
        case "stop":
          await this.controller.stop();
          break;
        case "newSession":
          await this.controller.createNewSession();
          break;
        case "selectSession":
          await this.controller.selectSession(parsed.sessionId);
          break;
        case "decideApproval":
          await this.controller.decideApproval(parsed.id, parsed.approved, parsed.scope);
          break;
        case "answerQuestion":
          await this.controller.answerQuestion(parsed.id, parsed.output, parsed.cancel);
          break;
        case "steerQueued":
          await this.controller.steerQueued(parsed.id);
          break;
        case "steerAllQueued":
          await this.controller.steerAllQueued();
          break;
        case "removeQueued":
          this.controller.removeQueued(parsed.id);
          break;
        case "setModel":
          await this.controller.setModel(parsed.model);
          break;
        case "setAccessPreset":
          await this.controller.setAccessPreset(parsed.preset);
          break;
        case "setBusyEnter":
          await this.controller.setBusyEnter(parsed.busyEnter);
          break;
        case "attachActiveEditor":
          await this.actions.onAttachActiveEditor();
          break;
        case "explainSelection":
          await this.actions.onExplainSelection();
          break;
        case "fixDiagnostics":
          await this.actions.onFixDiagnostics();
          break;
        case "uploadFiles":
          await this.controller.uploadFiles(parsed.files);
          break;
        case "removeAttachment":
          this.controller.removeAttachment(parsed.id);
          break;
        case "openFile":
          await this.actions.onOpenFile(parsed.reference);
          break;
        case "openWebUi":
          await this.actions.onOpenWebUi();
          break;
        case "openTerminal":
          await this.actions.onOpenTerminal();
          break;
        case "reconnect":
          await this.controller.reconnect();
          break;
      }
    } catch (error) {
      this.postMessage({
        type: "toast",
        level: "error",
        message: error instanceof Error ? error.message : "Operation failed.",
      });
    }
  }
}
