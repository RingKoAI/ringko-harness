// Execute with Node so node-pty and the npm launcher use the customer's runtime.
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const [entry, workspace] = process.argv.slice(2);
const requireInstalled = createRequire(entry);
const pty = requireInstalled("node-pty");
const child = pty.spawn(process.execPath, [entry, "--workspace", workspace], {
  cwd: workspace, env: { ...process.env, TERM: "xterm-256color" }, cols: 100, rows: 32,
});
let output = "", submitted = false, exiting = false;
const timer = setTimeout(() => {
  child.kill(); console.error(`Installed TUI timed out:\n${output.slice(-6000)}`); process.exitCode = 1;
}, 30000);
child.onData(data => {
  output = (output + data).slice(-100000);
  // ConPTY's initial cursor query must be answered without a physical terminal.
  if (data.includes("\x1b[6n")) child.write("\x1b[1;1R");
  if (!submitted && output.includes("What would you like to work on?")) {
    submitted = true;
    setTimeout(() => { child.write("npm-tty-no-bun"); setTimeout(() => child.write("\r"), 150); }, 250);
  }
  if (!exiting && output.includes("echo: npm-tty-no-bun")) {
    exiting = true;
    setTimeout(() => { child.write("/exit"); setTimeout(() => child.write("\r"), 150); }, 250);
  }
});
child.onExit(event => {
  clearTimeout(timer);
  try { assert.equal(event.exitCode, 0); assert.ok(submitted && exiting, output.slice(-6000)); console.log("Verified installed interactive TUI, shared backend execution and /exit without external Bun."); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  // node-pty's Windows control pipes can stay referenced after its child exits.
  // This isolated verification host has no remaining work after the exit event.
  process.stdout.write("", () => process.stderr.write("", () => process.exit(process.exitCode ?? 0)));
});
