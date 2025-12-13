import { createServer } from "http";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname);
const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

function withinRoot(p) {
  const rel = path.relative(ROOT, p);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function serveFile(filePath, res) {
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  } catch (err) {
    if (err.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 not found");
    } else {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("500 internal error");
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === "/") {
    pathname = "/viewer/ekgquest_lab.html";
  }

  const filePath = path.join(ROOT, pathname);
  if (!withinRoot(filePath)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403 forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, "index.html");
      const hasIndex = await fs
        .stat(indexPath)
        .then((s) => s.isFile())
        .catch(() => false);
      if (hasIndex) return serveFile(indexPath, res);
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("403 directory listing disabled");
      return;
    }
    return serveFile(filePath, res);
  } catch (err) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 not found");
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}/viewer/ekgquest_lab.html`;
  console.log(`Serving ${ROOT}`);
  console.log(`Open ${url}`);
  console.log(`Set PORT or HOST env vars to override.`);
});
