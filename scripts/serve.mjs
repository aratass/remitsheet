// Minimal static file server for local testing: node scripts/serve.mjs [dir] [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const dir = resolve(process.argv[2] || "docs");
const port = Number(process.argv[3] || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function startServer(root = dir, p = port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (path.endsWith("/")) path += "index.html";
    const file = join(root, path);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  });
  return new Promise((ok) => server.listen(p, "127.0.0.1", () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startServer();
  console.log(`serving ${dir} on http://127.0.0.1:${port}`);
}
