import { Box, Text, useInput } from "ink";
import type { ToolApprovalRequest } from "@ringko-ai/sdk";
import { theme } from "../theme.ts";

export interface ApprovalDialogProps {
  request: ToolApprovalRequest;
  onAnswer: (approved: boolean) => void;
}

export function ApprovalDialog({ request, onAnswer }: ApprovalDialogProps) {
  useInput((input, key) => {
    if (input === "y" || input === "Y" || key.return) onAnswer(true);
    else if (input === "n" || input === "N" || key.escape) onAnswer(false);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.permission} paddingX={1}>
      <Text color={theme.permission} bold>
        Approve {request.toolName}?
      </Text>
      <Text color={theme.dim}>
        {request.riskKind} · {request.riskLevel}
      </Text>
      <Text>{request.reason}</Text>
      {request.target ? <Text color={theme.dim}>target: {request.target}</Text> : null}
      <Text color={theme.dim}>y approve · n reject</Text>
    </Box>
  );
}
