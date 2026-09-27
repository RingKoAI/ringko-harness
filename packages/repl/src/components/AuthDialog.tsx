import { Box, Text, useInput } from "ink";
import { copyToClipboard } from "../clipboard.ts";
import { theme } from "../theme.ts";

export interface AuthBox {
  title: string;
  url: string;
  instructions?: string;
}

export interface AuthDialogProps {
  auth: AuthBox;
  onCopied: (label: string) => void;
  onClose: () => void;
}

const CODE_PATTERN = /[A-Z0-9]{4}-[A-Z0-9]{4,5}/;

export function AuthDialog({ auth, onCopied, onClose }: AuthDialogProps) {
  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (input === "c") {
      const code = auth.instructions?.match(CODE_PATTERN)?.[0];
      if (code) {
        copyToClipboard(code);
        onCopied("code");
      } else {
        copyToClipboard(auth.url);
        onCopied("URL");
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.permission} paddingX={1}>
      <Text bold>{auth.title}</Text>
      <Text color={theme.brand}>{auth.url}</Text>
      {auth.instructions ? <Text color={theme.dim}>{auth.instructions}</Text> : null}
      <Text color={theme.dim}>waiting for authorization…</Text>
      <Text>
        c <Text color={theme.dim}>copy</Text> · esc <Text color={theme.dim}>hide</Text>
      </Text>
    </Box>
  );
}
