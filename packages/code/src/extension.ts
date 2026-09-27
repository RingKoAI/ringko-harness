import * as vscode from "vscode";
import { createRingKo, type RingKo } from "@ringko-ai/sdk";

export function activate(context: vscode.ExtensionContext): void {
  const ringko: RingKo = createRingKo({
    model: async () => ({ content: "RingKo Code is not wired to a model yet.", toolCalls: [] }),
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("ringko.status", () => {
      void vscode.window.showInformationMessage(
        `RingKo: access=${ringko.access.id}, tools=${String(ringko.tools.list().length)}`,
      );
    }),
  );
}

export function deactivate(): void {}
