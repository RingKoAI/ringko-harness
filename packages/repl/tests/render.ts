import { render as inkRender, type RenderOptions } from "ink";
import type { ReactNode } from "react";

/** Simulated TTY tests need live frames even when the host is a CI runner. */
export function render(node: ReactNode, options: RenderOptions) {
  return inkRender(node, { ...options, interactive: true });
}
