import { expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { createElement } from "react";
import { Box, render, Text } from "ink";

it("renders the first frame in the alternate screen without input and restores on exit", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode: () => input, ref: () => input, unref: () => input });
  Object.assign(output, { isTTY: true, columns: 80, rows: 24 });
  let captured = "";
  output.on("data", chunk => { captured += chunk.toString(); });
  const frameNode = (body: string) => createElement(Box, { flexDirection: "column" }, createElement(Text, null, "RingKo · test"), createElement(Text, null, body));
  const app = render(frameNode("FIRST FRAME"), { stdin: input as unknown as NodeJS.ReadStream, stdout: output as unknown as NodeJS.WriteStream, stderr: output as unknown as NodeJS.WriteStream, alternateScreen: true, incrementalRendering: true, exitOnCtrlC: false });
  try {
    await app.waitUntilRenderFlush();
    const entered = captured.indexOf("\x1b[?1049h");
    const frame = captured.indexOf("FIRST FRAME");
    expect(entered).toBeGreaterThanOrEqual(0);
    expect(frame).toBeGreaterThan(entered);
    expect(captured.lastIndexOf("\x1b[?1049h")).toBe(entered);
    app.rerender(frameNode("SECOND FRAME"));
    await app.waitUntilRenderFlush();
    expect(captured).toContain("SECOND FRAME");
    expect(captured.split("RingKo · test").length - 1).toBe(1);
    app.unmount();
    await app.waitUntilExit();
    const restored = captured.lastIndexOf("\x1b[?1049l");
    expect(restored).toBeGreaterThan(frame);
    expect(captured.slice(restored)).not.toContain("FIRST FRAME");
  } finally { app.cleanup(); input.destroy(); output.destroy(); }
});
