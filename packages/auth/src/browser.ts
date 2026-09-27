// Best-effort system browser opener. Failure is non-fatal: callers also print
// the URL so the user can open it manually.
import { spawn } from "node:child_process";

export function openBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      // Do NOT go through `cmd /c start`: cmd treats `&` (present in OAuth
      // query strings) as a command separator and truncates the URL, dropping
      // required parameters. `rundll32` receives the URL as a single argument
      // without any shell parsing.
      spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // The caller surfaces the URL regardless.
  }
}
