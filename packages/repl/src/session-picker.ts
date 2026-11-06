import type { SelectorItem } from "./components/Selector.tsx";
import { GLYPH } from "./glyphs.ts";

export interface RemoteSessionMeta {
  id: string;
  createdAt: number;
  cwd: string | null;
  title?: string | null;
  summary?: string | null;
  busy?: boolean;
}

/** Build picker rows from backend session metadata; `busy` is the live run flag. */
export function remoteSessionItems(sessions: readonly RemoteSessionMeta[]): SelectorItem[] {
  return sessions.map(meta => {
    const running = meta.busy === true;
    const title = meta.title ?? meta.id;
    return {
      value: meta.id,
      label: running ? `${GLYPH.running} ${title}` : title,
      description: `${running ? "running · " : ""}${meta.summary ?? new Date(meta.createdAt).toLocaleString()}`,
      group: meta.cwd ?? "Sessions",
    };
  });
}
