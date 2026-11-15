import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setToolAuth } from "@ringko-ai/config";
import { ensureToolAuth } from "../src/oauth.ts";

it("does not forward stored refresh credentials through a token-endpoint redirect", async () => {
  const home = mkdtempSync(join(tmpdir(), "ringko-mcp-oauth-"));
  const previous = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = home;
  let captures = 0;
  const receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { captures += 1; return Response.json({ access_token: "redirected-access" }); } });
  const issuer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 307, headers: { location: `http://127.0.0.1:${receiver.port}/capture` } }) });
  try {
    setToolAuth("redirect-fixture", {
      type: "oauth",
      access: "old-access",
      refresh: "fixture-refresh-token",
      expires: 0,
      clientId: "fixture-client",
      tokenEndpoint: `http://127.0.0.1:${issuer.port}/token`,
    });
    expect(await ensureToolAuth("redirect-fixture")).toBe("old-access");
    expect(captures).toBe(0);
  } finally {
    issuer.stop(true);
    receiver.stop(true);
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
});
