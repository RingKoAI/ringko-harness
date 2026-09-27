import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useState } from "react";
import { filterCommands } from "../commands.ts";
import { theme } from "../theme.ts";

export interface PromptInputProps {
  running: boolean;
  onSubmit: (value: string) => void;
}

const MAX_SUGGESTIONS = 6;

export function PromptInput({ running, onSubmit }: PromptInputProps) {
  const { exit } = useApp();
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState(0);

  const suggestions =
    value.startsWith("/") && !/\s/.test(value) ? filterCommands(value.slice(1)).slice(0, MAX_SUGGESTIONS) : [];
  const active = Math.min(selected, Math.max(0, suggestions.length - 1));

  useEffect(() => {
    setSelected(0);
  }, [value]);

  // Ctrl+C clears the input; pressing it again on an empty input exits.
  // Ctrl+D exits immediately.
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (value.length > 0) {
        setValue("");
        setSelected(0);
      } else {
        exit();
      }
      return;
    }
    if (key.ctrl && input === "d") exit();
  });

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setSelected((current) => Math.max(0, current - 1));
      } else if (key.downArrow) {
        setSelected((current) => Math.min(suggestions.length - 1, current + 1));
      } else if (key.tab) {
        const chosen = suggestions[active];
        if (chosen) setValue(`/${chosen.name} `);
      }
    },
    { isActive: suggestions.length > 0 },
  );

  return (
    <Box flexDirection="column">
      {suggestions.length > 0 ? (
        <Box flexDirection="column" paddingX={1}>
          {suggestions.map((command, index) => (
            <Box key={command.name}>
              <Text
                color={index === active ? theme.brand : undefined}
                backgroundColor={index === active ? theme.userBackground : undefined}
                bold={index === active}
              >
                /{command.name}
              </Text>
              <Text color={theme.dim}>
                {"  "}
                {command.description}
              </Text>
            </Box>
          ))}
          <Text color={theme.dim}>↑/↓ select · tab complete · enter run</Text>
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
            let text = submitted.trim();
            if (text.length === 0) return;
            if (suggestions.length > 0 && !text.includes(" ")) {
              const chosen = suggestions[active];
              if (chosen) text = `/${chosen.name}`;
            }
            setValue("");
            onSubmit(text);
          }}
        />
      </Box>
    </Box>
  );
}
