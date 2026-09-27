import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";
import { theme } from "../theme.ts";

export interface PromptInputProps {
  running: boolean;
  onSubmit: (value: string) => void;
}

export function PromptInput({ running, onSubmit }: PromptInputProps) {
  const [value, setValue] = useState("");
  return (
    <Box borderStyle="round" borderColor={theme.border} borderLeft={false} borderRight={false} paddingX={0}>
      <Text color={theme.brand}>{"❯ "}</Text>
      <TextInput
        value={value}
        onChange={setValue}
        placeholder={running ? "working…" : "Type a message, or /help"}
        onSubmit={(submitted) => {
          if (running) return;
          const text = submitted.trim();
          if (text.length === 0) return;
          setValue("");
          onSubmit(submitted);
        }}
      />
    </Box>
  );
}
