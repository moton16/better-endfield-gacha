/**
 * 测试辅助：把多个按主机/条件分发的 fetch handler 合并成一个 fetch。
 */
export interface FetchRoute {
  match(url: URL, init?: RequestInit): boolean;
  fetch: typeof fetch;
}

export function combineFetch(...routes: FetchRoute[]): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    for (const r of routes) {
      if (r.match(url, init)) return r.fetch(input, init);
    }
    return new Response(JSON.stringify({ status: 404, code: 404, msg: `unmatched route ${url.hostname}${url.pathname}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

export function readJsonBodyToken(init?: RequestInit): string | undefined {
  if (typeof init?.body !== "string") return undefined;
  try {
    const parsed = JSON.parse(init.body) as { token?: unknown };
    return typeof parsed.token === "string" ? parsed.token : undefined;
  } catch {
    return undefined;
  }
}
