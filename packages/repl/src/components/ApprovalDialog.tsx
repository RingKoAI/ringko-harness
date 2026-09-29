import { Box, Text, useInput, useStdout } from "ink";
import { useState } from "react";
import wrapAnsi from "wrap-ansi";
import type { ToolApprovalRequest } from "@ringko-ai/sdk";
import { theme } from "../theme.ts";
import { cleanTerminalText, fitTerminalLine } from "../editor.ts";

export interface ApprovalDialogProps {
  request: ToolApprovalRequest;
  onAnswer: (approved: boolean, scope?: "session" | "saved") => void;
}

export function ApprovalDialog({ request, onAnswer }: ApprovalDialogProps) {
  const { stdout } = useStdout();
  const [offset, setOffset] = useState(0);
  const width = Math.max(1, (stdout.columns ?? 80) - 4);
  const count = Math.max(1, Math.min(4, (stdout.rows ?? 24) - 10));
  const details = wrapAnsi(cleanTerminalText(`${request.reason}${request.target ? `\ntarget: ${request.target}` : ""}`), width, { hard: true, trim: false }).split("\n");
  const start = Math.min(offset, Math.max(0, details.length - count));
  useInput((input, key) => {
    if (key.pageUp || key.upArrow) { setOffset(Math.max(0, start - count)); return; }
    if (key.pageDown || key.downArrow) { setOffset(Math.min(Math.max(0, details.length - count), start + count)); return; }
    if (request.remember && input.toLowerCase() === "s") onAnswer(true, "session");
    else if (request.remember && input.toLowerCase() === "a") onAnswer(true, "saved");
    else if (input === "y" || input === "Y" || key.return) onAnswer(true);
    else if (input === "n" || input === "N" || key.escape) onAnswer(false);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.permission} paddingX={1}>
      <Text color={theme.permission} bold>
        {fitTerminalLine(`Approve ${request.toolName}?`, width)}
      </Text>
      <Text color={theme.dim}>
        {fitTerminalLine(`${request.riskKind} · ${request.riskLevel}`, width)}
      </Text>
      {details.slice(start, start + count).map((line, index) => <Text key={index}>{line}</Text>)}
      {request.remember ? <Text color={theme.dim}>{fitTerminalLine("s allow for session · a save rule (same tool and target)", width)}</Text> : null}
      <Text color={theme.dim}>{fitTerminalLine(`y allow once · n reject${details.length > count ? " · PgUp/PgDn details" : ""}`, width)}</Text>
    </Box>
  );
}
