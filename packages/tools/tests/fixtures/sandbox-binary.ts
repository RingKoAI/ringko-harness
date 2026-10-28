import { spawnSync } from "node:child_process";
import { Sandbox } from "../../src/sandbox.ts";

const workspace = process.argv[2];
if (!workspace) throw new Error("A probe workspace is required.");
const sandbox = new Sandbox({ workspace });
const invocation = sandbox.shell("echo relocated > relocated.txt");
const result = spawnSync(invocation.executable, invocation.args, { cwd: invocation.cwd, env: invocation.env, encoding: "utf8" });
if (result.status !== 0) throw new Error(`Relocated native sandbox failed: ${result.stderr}`);
