import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { theme } from "../theme.ts";

export interface SelectorItem {
  label: string;
  value: string;
  current?: boolean;
}

export interface SelectorProps {
  title: string;
  items: readonly SelectorItem[];
  onSelect: (value: string) => void;
  onCancel: () => void;
}

export function Selector({ title, items, onSelect, onCancel }: SelectorProps) {
  const currentIndex = items.findIndex((item) => item.current);
  const [index, setIndex] = useState(currentIndex >= 0 ? currentIndex : 0);
  const active = Math.min(index, Math.max(0, items.length - 1));

  useInput((_input, key) => {
    if (key.upArrow) setIndex((value) => Math.max(0, value - 1));
    else if (key.downArrow) setIndex((value) => Math.min(items.length - 1, value + 1));
    else if (key.return) onSelect(items[active].value);
    else if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.permission} paddingX={1}>
      <Text bold>{title}</Text>
      {items.map((item, itemIndex) => (
        <Text
          key={item.value}
          color={itemIndex === active ? theme.brand : undefined}
          backgroundColor={itemIndex === active ? theme.userBackground : undefined}
          bold={itemIndex === active}
        >
          {itemIndex === active ? "❯ " : "  "}
          {item.label}
          {item.current ? "  (current)" : ""}
        </Text>
      ))}
      <Text color={theme.dim}>↑/↓ select · enter confirm · esc cancel</Text>
    </Box>
  );
}
