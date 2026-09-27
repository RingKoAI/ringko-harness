import { Box } from "ink";
import { MessageRow } from "./MessageRow.tsx";
import type { ReplItem } from "../state.ts";

export interface TranscriptProps {
  items: readonly ReplItem[];
  /** Maximum number of recent items rendered. */
  limit?: number;
}

export function Transcript({ items, limit = 40 }: TranscriptProps) {
  const visible = items.length > limit ? items.slice(items.length - limit) : items;
  return (
    <Box flexDirection="column">
      {visible.map((item) => (
        <MessageRow key={item.id} item={item} />
      ))}
    </Box>
  );
}
