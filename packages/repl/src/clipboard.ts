// Clipboard copy: OSC52 (works over SSH/tmux) plus a native fallback.
import { spawn } from "node:child_process";

function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return;
  const sequence = `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`;
  const passthrough = `\x1bPtmux;\x1b${sequence}\x1b\\`;
  process.stdout.write(process.env.TMUX ? sequence + passthrough : process.env.STY ? passthrough : sequence);
}

function nativeCopy(text: string): void {
  const pipe = (command: string, args: string[]): void => {
    try {
      const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", () => {});
      child.stdin?.end(text);
    } catch {
      // OSC52 already emitted; the native path is best-effort.
    }
  };

  if (process.platform === "win32") pipe("clip", []);
  else if (process.platform === "darwin") pipe("pbcopy", []);
  else if (process.env.WAYLAND_DISPLAY) pipe("wl-copy", []);
  else pipe("xclip", ["-selection", "clipboard"]);
}

/** Copy text to the system clipboard (OSC52 + native). */
export function copyToClipboard(text: string): void {
  writeOsc52(text);
  nativeCopy(text);
}
