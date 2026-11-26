import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function isInsideRoot(rootReal: string, filePath: string): boolean {
  try {
    const real = fs.realpathSync(filePath);
    return real.startsWith(rootReal + path.sep);
  } catch {
    return false;
  }
}

export function serveStatic(root: string, pathname: string, res: ServerResponse, method = "GET"): boolean {
  const rootAbs = path.resolve(root);
  if (!fs.existsSync(rootAbs)) return false;
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(rootAbs);
  } catch {
    return false;
  }

  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (rel.includes("\0") || rel.includes("\\")) return false;
  if (rel.endsWith("/")) rel += "index.html";

  let file = path.resolve(rootAbs, "." + rel);
  if (file !== rootAbs && !file.startsWith(rootAbs + path.sep)) return false; // 路径穿越

  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(rel)) return false; // 缺失的资源文件 → 404
    file = path.join(rootAbs, "index.html"); // SPA 回退
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  }

  if (!isInsideRoot(rootReal, file)) return false;

  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Content-Length": stat.size,
  });
  if (method === "HEAD") {
    res.end();
    return true;
  }
  const stream = fs.createReadStream(file);
  stream.on("error", () => {
    if (!res.writableEnded) res.destroy();
  });
  stream.pipe(res);
  return true;
}
