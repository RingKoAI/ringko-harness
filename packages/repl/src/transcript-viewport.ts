import type { TranscriptLine } from "./transcript-layout.ts";

interface Anchor { itemId: number; position: number; leading: number }
export interface TranscriptViewport {
  offset: number;
  anchor?: Anchor;
  page: readonly TranscriptLine[];
  pending: boolean;
  tail?: string;
  columns: number;
  viewKey: string;
}

/** Pin a message position while reading history, instead of chasing a moving tail. */
export function transcriptViewport(lines: readonly TranscriptLine[], rows: number, columns: number, offset: number, viewKey: string, previous?: TranscriptViewport): TranscriptViewport {
  const height = Math.max(0, Math.floor(rows));
  const sameView = previous?.viewKey === viewKey;
  const continuing = sameView && previous.offset === offset && offset > 0;
  const history = offset > 0 && lines.length > height;
  const available = Math.max(0, height - (history ? 1 : 0));
  const tailLine = lines.at(-1);
  const tail = tailLine ? `${tailLine.itemId}:${tailLine.position}:${tailLine.text}` : undefined;
  let end = Math.max(available, lines.length - Math.max(0, offset));
  if (continuing && previous.anchor) {
    let match = -1;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (line.itemId === previous.anchor.itemId && line.position <= previous.anchor.position && line.position >= 0) match = index;
    }
    if (match >= 0) end = Math.max(0, match - previous.anchor.leading) + available;
  }
  end = Math.min(lines.length, Math.max(0, end));
  const actual = history ? Math.max(0, lines.length - end) : 0;
  if (!actual) end = lines.length;
  const count = actual ? available : height;
  const page = height ? lines.slice(Math.max(0, end - count), end) : [];
  const firstIndex = page.findIndex(line => line.position >= 0);
  const first = page[firstIndex];
  return {
    offset: actual, page,
    anchor: actual && first ? { itemId: first.itemId, position: first.position, leading: firstIndex } : actual && sameView ? previous.anchor : undefined,
    pending: Boolean(actual && sameView && (previous.pending || (previous.columns === columns && previous.tail !== tail))),
    tail, columns, viewKey,
  };
}
