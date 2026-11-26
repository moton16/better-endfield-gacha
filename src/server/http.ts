import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "error",
  ) {
    super(message);
  }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  /** 读取并解析 JSON 请求体；超过 limit 抛 413 */
  json<T = unknown>(limit?: number): Promise<T>;
}

export type Handler = (c: Ctx) => Promise<unknown> | unknown;

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    const keys: string[] = [];
    const re = new RegExp(
      "^" +
        pattern.replace(/:[A-Za-z]+/g, (m) => {
          keys.push(m.slice(1));
          return "([^/]+)";
        }) +
        "$",
    );
    this.routes.push({ method, re, keys, handler });
    return this;
  }

  get = (p: string, h: Handler) => this.add("GET", p, h);
  post = (p: string, h: Handler) => this.add("POST", p, h);
  del = (p: string, h: Handler) => this.add("DELETE", p, h);
  delete = (p: string, h: Handler) => this.add("DELETE", p, h);

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      for (let i = 0; i < r.keys.length; i++) {
        const k = r.keys[i]!;
        try {
          params[k] = decodeURIComponent(m[i + 1]!);
        } catch {
          throw new HttpError(400, "路径参数编码非法", "bad_request");
        }
      }
      return { handler: r.handler, params };
    }
    return null;
  }
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const cl = req.headers["content-length"];
  if (cl !== undefined) {
    const declared = Number(cl);
    if (Number.isFinite(declared) && declared > limit) {
      throw new HttpError(413, "请求体过大", "too_large");
    }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c));
    size += buf.length;
    if (size > limit) throw new HttpError(413, "请求体过大", "too_large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  const headers: Record<string, string | number> = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text, "utf8"),
  };
  if (status === 413) {
    headers.Connection = "close";
  }
  res.writeHead(status, headers);
  res.end(text);
}
