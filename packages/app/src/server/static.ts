// Static WebUI assets and Vite dev-server proxying.

import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { isPathInside } from "@ringko-ai/config";
import { json } from "./http.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

export async function serveStatic(webuiDir: string, pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const root = resolve(webuiDir);
  const target = resolve(join(root, rel));
  if (!isPathInside(root, target)) return json({ error: "not found" }, 404);
  let file = target;
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(webuiDir, "index.html");
  }
  try {
    const bytes = await readFile(file);
    // Content-hashed bundles can be cached forever; HTML must revalidate so a
    // rebuilt WebUI is picked up instead of pinning the previous asset names.
    const hashedAsset = relative(webuiDir, file).split(sep)[0] === "assets";
    return new Response(bytes, {
      headers: {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "cache-control": hashedAsset ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  } catch {
    return new Response("RingKo WebUI is not built yet. Run `pnpm --filter @ringko-ai/webui build`.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

export async function proxyDev(devServerUrl: string, request: Request, url: URL): Promise<Response> {
  const target = new URL(url.pathname + url.search, devServerUrl);
  const headers = new Headers(request.headers);
  headers.delete("host");
  const init: RequestInit = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }
  try {
    return await fetch(target, init);
  } catch {
    return new Response(
      `Dev server unreachable at ${devServerUrl}. Start \`pnpm --filter @ringko-ai/webui dev\`.`,
      { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
}
