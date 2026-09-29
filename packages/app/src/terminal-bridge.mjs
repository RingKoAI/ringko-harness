import { createRequire } from "node:module";
import { createInterface } from "node:readline";

const require = createRequire(import.meta.url);
const pty = require("node-pty");
const controls = createInterface({ input: process.stdin, crlfDelay: Infinity });
let terminal;

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function reportError(error) {
  emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
}

controls.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    reportError("Invalid terminal control message.");
    return;
  }

  if (message.type === "start") {
    if (terminal) {
      reportError("Terminal has already started.");
      return;
    }
    try {
      terminal = pty.spawn(message.shell, message.args, {
        name: "xterm-256color",
        cols: message.cols,
        rows: message.rows,
        cwd: message.cwd,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
      terminal.onData((data) => emit({ type: "output", data }));
      terminal.onExit(({ exitCode, signal }) => {
        emit({ type: "exit", exitCode, signal });
        process.stdout.write("", () => process.exit(0));
      });
    } catch (error) {
      reportError(error);
      process.exitCode = 1;
      process.stdout.write("", () => process.exit(1));
    }
    return;
  }

  if (!terminal) {
    reportError("Terminal is not ready.");
    return;
  }
  if (message.type === "input" && typeof message.data === "string") terminal.write(message.data);
  else if (message.type === "resize" && Number.isInteger(message.cols) && Number.isInteger(message.rows)) {
    terminal.resize(message.cols, message.rows);
  } else if (message.type === "dispose") {
    controls.close();
    terminal.kill();
  } else reportError("Unsupported terminal control message.");
});

controls.on("close", () => {
  if (terminal) terminal.kill();
});
