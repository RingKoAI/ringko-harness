import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "@ringko-ai/harness";
import { createReadTool } from "../src/index.ts";
import { createWorkspace } from "../src/workspace.ts";

/** A valid 1x1 transparent PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ringko-read-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const never = async (): Promise<boolean> => {
  throw new Error("Workspace reads must not request approval.");
};

describe("read", () => {
  it("returns an image part for a supported raster image", async () => {
    await writeFile(join(dir, "pixel.png"), PNG);
    const tool = createReadTool(createWorkspace(dir));
    const output = await executeTool(tool, { path: "pixel.png" }, never);
    expect(output.image).toEqual({
      mediaType: "image/png",
      data: PNG.toString("base64"),
      bytes: PNG.byteLength,
    });
    expect(output.content).toBeUndefined();

    const message = tool.toMessage!(output);
    expect(message.content).toContain("image/png");
    expect(message.parts).toEqual([
      { type: "text", text: message.content },
      { type: "image", mediaType: "image/png", data: PNG.toString("base64") },
    ]);
  });

  it("identifies images by magic bytes, not by extension", async () => {
    await writeFile(join(dir, "renamed.txt"), PNG);
    const output = await executeTool(createReadTool(createWorkspace(dir)), { path: "renamed.txt" }, never);
    expect(output.image?.mediaType).toBe("image/png");
  });

  it("renders a notebook with cells and text outputs", async () => {
    await writeFile(join(dir, "demo.ipynb"), JSON.stringify({
      cells: [
        { cell_type: "markdown", source: ["# Title\n", "body"] },
        {
          cell_type: "code",
          source: "print(1)",
          outputs: [
            { output_type: "stream", text: ["1\n"] },
            { output_type: "execute_result", data: { "text/plain": ["2"] } },
          ],
        },
      ],
    }));
    const output = await executeTool(createReadTool(createWorkspace(dir)), { path: "demo.ipynb" }, never);
    expect(output.content).toContain("# cell 1 (markdown)");
    expect(output.content).toContain("# Title");
    expect(output.content).toContain("# cell 2 (code)");
    expect(output.content).toContain("print(1)");
    expect(output.content).toContain("[output]");
    expect(output.content).toContain("1\n");
    expect(output.content).toContain("2");
  });

  it("rejects malformed notebooks", async () => {
    await writeFile(join(dir, "bad.ipynb"), "{not json");
    await expect(executeTool(createReadTool(createWorkspace(dir)), { path: "bad.ipynb" }, never))
      .rejects.toThrow("not valid JSON");
  });

  it("rejects binary files instead of returning mojibake", async () => {
    await writeFile(join(dir, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    await expect(executeTool(createReadTool(createWorkspace(dir)), { path: "blob.bin" }, never))
      .rejects.toThrow("appears to be binary");
  });

  it("returns plain text for text files instead of escaped JSON", async () => {
    await writeFile(join(dir, "a.txt"), "one");
    const tool = createReadTool(createWorkspace(dir));
    const output = await executeTool(tool, { path: "a.txt" }, never);
    const message = tool.toMessage!(output);
    expect(message.content).toContain("File: a.txt");
    expect(message.content).toContain("     1→one");
    expect(message.content).not.toContain('\\"content\\"');
    expect(message.parts).toBeUndefined();
  });

  it("renders directory listings as plain text", async () => {
    await writeFile(join(dir, "b.txt"), "x");
    const tool = createReadTool(createWorkspace(dir));
    const output = await executeTool(tool, { path: "." }, never);
    const message = tool.toMessage!(output);
    expect(message.content).toContain("Directory: .");
    expect(message.content).toContain("b.txt");
  });

  it("extracts PDF text per page", async () => {
    const sample = await readFile(join(import.meta.dir, "fixtures", "sample.pdf"));
    await writeFile(join(dir, "doc.pdf"), sample);
    const output = await executeTool(createReadTool(createWorkspace(dir)), { path: "doc.pdf" }, never);
    expect(output.pdf).toEqual({ pages: 1, bytes: sample.byteLength });
    expect(output.content).toContain("--- page 1 ---");
    expect(output.content).toContain("Hello PDF from a real writer");
  });

  it("identifies PDFs by magic bytes rather than extension", async () => {
    const sample = await readFile(join(import.meta.dir, "fixtures", "sample.pdf"));
    await writeFile(join(dir, "renamed.txt"), sample);
    const output = await executeTool(createReadTool(createWorkspace(dir)), { path: "renamed.txt" }, never);
    expect(output.pdf?.pages).toBe(1);
    expect(output.content).toContain("Hello PDF from a real writer");
  });

  it("refuses a PDF without a text layer", async () => {
    await writeFile(join(dir, "scan.pdf"), makePdf(""));
    await expect(executeTool(createReadTool(createWorkspace(dir)), { path: "scan.pdf" }, never))
      .rejects.toThrow("no extractable text");
  });

  it("refuses a corrupt PDF", async () => {
    await writeFile(join(dir, "broken.pdf"), Buffer.from("%PDF-1.4\nnot a real pdf"));
    await expect(executeTool(createReadTool(createWorkspace(dir)), { path: "broken.pdf" }, never))
      .rejects.toThrow("Could not read PDF");
  });

  it("refuses an oversized PDF before extraction", async () => {
    const file = await open(join(dir, "huge.pdf"), "w");
    await file.write(Buffer.from("%PDF-1.4"));
    await file.truncate(20 * 1024 * 1024 + 1);
    await file.close();
    await expect(executeTool(createReadTool(createWorkspace(dir)), { path: "huge.pdf" }, never))
      .rejects.toThrow("too large to read");
  });
});

/** Build a minimal single-page PDF with an uncompressed Helvetica text run. */
function makePdf(text: string): Buffer {
  const content = text ? `BT /F1 24 Tf 20 100 Td (${text}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
