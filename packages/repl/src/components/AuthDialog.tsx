import { Text, useInput, useStdout } from "ink";
import { copyToClipboard } from "../clipboard.ts";
import { theme } from "../theme.ts";
import { fitTerminalLine } from "../editor.ts";
import { Panel } from "./Panel.tsx";
import { terminalColumns } from "../terminal-layout.ts";

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
  const { stdout } = useStdout();
  const width = Math.max(1, terminalColumns(stdout.columns ?? 80) - 4);
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) {
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
    <Panel title={auth.title} color={theme.permission}>
      <Text color={theme.brand}>{fitTerminalLine(auth.url, width)}</Text>
      {auth.instructions ? <Text color={theme.dim}>{fitTerminalLine(auth.instructions, width)}</Text> : null}
      <Text color={theme.dim}>waiting for authorization…</Text>
      <Text>
        c <Text color={theme.dim}>copy</Text> · esc <Text color={theme.dim}>hide</Text>
      </Text>
    </Panel>
  );
}
