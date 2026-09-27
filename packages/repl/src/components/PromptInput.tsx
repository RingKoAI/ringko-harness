import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";
import { filterCommands } from "../commands.ts";
import { theme } from "../theme.ts";

export interface PromptInputProps {
  running: boolean;
  onSubmit: (value: string) => void;
}

export function PromptInput({ running, onSubmit }: PromptInputProps) {
  const [value, setValue] = useState("");
  const suggestions =
    value.startsWith("/") && !/\s/.test(value) ? filterCommands(value.slice(1)).slice(0, 6) : [];

  return (
    <Box flexDirection="column">
      {suggestions.length > 0 ? (
        <Box flexDirection="column" paddingX={1}>
          {suggestions.map((command) => (
            <Box key={command.name}>
              <Text color={theme.brand}>/{command.name}</Text>
              <Text color={theme.dim}>
                {"  "}
                {command.description}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}
      <Box borderStyle="round" borderColor={theme.border} borderLeft={false} borderRight={false}>
        <Text color={theme.brand}>{"❯ "}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          placeholder={running ? "working…" : "Type a message, or / for commands"}
          onSubmit={(submitted) => {
            if (running) return;
            const text = submitted.trim();
            if (text.length === 0) return;
            setValue("");
            onSubmit(submitted);
          }}
        />
      </Box>
    </Box>
  );
}
