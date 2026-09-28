// Minimal stdio MCP server for tests: initialize, tools/list, tools/call.
const decoder = new TextDecoder();

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function main(): Promise<void> {
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
      if (line.length === 0) continue;
      const message = JSON.parse(line) as { id?: string; method?: string; params?: { name?: string; arguments?: unknown } };
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1" } } });
      } else if (message.method === "tools/list") {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              {
                name: "echo",
                description: "Echo the input text.",
                inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
              },
            ],
          },
        });
      } else if (message.method === "tools/call") {
        send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(message.params?.arguments ?? {}) }] } });
      } else if (message.id !== undefined) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } });
      }
    }
  }
}

void main();
