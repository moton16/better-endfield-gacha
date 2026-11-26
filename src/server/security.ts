import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./http.js";

export function newKey(): string {
  return randomBytes(24).toString("base64url");
}

export function applySecurityHeaders(res: ServerResponse, isApi: boolean): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  if (!isApi) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    );
  }
}

export function checkHost(req: IncomingMessage, port: number): void {
  const host = (req.headers.host ?? "").toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    throw new HttpError(403, "Host 不被允许", "bad_host");
  }
}

export function checkApi(req: IncomingMessage, key: string, port: number): void {
  const rawKey = req.headers["x-beg-key"];
  const given = Array.isArray(rawKey) ? (rawKey[0] ?? "") : String(rawKey ?? "");
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(key, "utf8");
  if (a.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(401, "缺少或错误的 X-BEG-Key", "unauthorized");
  }

  const rawOrigin = req.headers.origin;
  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
    throw new HttpError(403, "Origin 不被允许", "bad_origin");
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    const ct = String(req.headers["content-type"] ?? "").toLowerCase();
    if (!ct.startsWith("application/json")) {
      throw new HttpError(415, "变更请求必须是 application/json", "bad_content_type");
    }
  }
}
