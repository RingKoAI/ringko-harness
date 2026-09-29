import { expect, it } from "bun:test";
import stringWidth from "string-width";
import { terminalLayout } from "../src/terminal-layout.ts";
import { fitTerminalLine } from "../src/editor.ts";

it("reserves the last terminal row and removes optional panels on short screens and dialogs", () => {
  expect(terminalLayout(24, false)).toMatchObject({ height: 23, todoRows: 4, jobRows: 2 });
  expect(terminalLayout(12, false)).toMatchObject({ height: 11, todoRows: 0, jobRows: 0, compact: true });
  expect(terminalLayout(24, true)).toMatchObject({ todoRows: 0, jobRows: 0 });
});

it("fits CJK, graphemes and unsafe multiline status labels on one row", () => {
  for (const width of [0, 1, 4, 12, 40]) {
    const output = fitTerminalLine("中文工作区 👩‍💻\n\x1b[2JLong path", width);
    expect(stringWidth(output)).toBeLessThanOrEqual(width);
    expect(output).not.toContain("\n");
    expect(output).not.toContain("\x1b");
  }
});
