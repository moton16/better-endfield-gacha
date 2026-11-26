import { isMock, mockDownload, mockFetch } from "./mock.js";

const KEY_STORE = "beg.key";
let memKey: string | null = null;

function safeStorageGet(k: string): string | null {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return memKey;
  }
}

function safeStorageSet(k: string, v: string): void {
  memKey = v;
  try {
    sessionStorage.setItem(k, v);
  } catch {
    // 忽略受限环境下的 sessionStorage 异常，保留内存态
  }
}

function safeStorageRemove(k: string): void {
  memKey = null;
  try {
    sessionStorage.removeItem(k);
  } catch {
    // 忽略
  }
}

/** 读取 #k=<key>，写入会话存储并立即从地址栏抹除 fragment */
export function bootstrapKey(): string | null {
  const m = /[#&]k=([^&]+)/.exec(location.hash);
  if (m && m[1]) {
    let decoded = m[1];
    try {
      decoded = decodeURIComponent(m[1]);
    } catch {
      // 保留原始片段值
    }
    const clean = decoded.trim();
    if (clean) {
      safeStorageSet(KEY_STORE, clean);
    }
    history.replaceState(null, "", location.pathname + location.search);
  }
  return safeStorageGet(KEY_STORE);
}

export function getKey(): string | null {
  return safeStorageGet(KEY_STORE);
}

export function setKey(k: string): void {
  const clean = k.trim();
  if (clean) {
    safeStorageSet(KEY_STORE, clean);
  } else {
    safeStorageRemove(KEY_STORE);
  }
}

export function clearKey(): void {
  safeStorageRemove(KEY_STORE);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (isMock()) {
    return mockFetch<T>(path, init);
  }
  const key = getKey() ?? "";
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: {
      "X-BEG-Key": key,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, j.error ?? "error", j.message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** 下载文件（需附带 X-BEG-Key，不能用裸 <a href>） */
export async function download(path: string, filename: string): Promise<void> {
  if (isMock()) {
    return mockDownload(path, filename);
  }
  const key = getKey() ?? "";
  const res = await fetch(path, {
    headers: {
      "X-BEG-Key": key,
    },
  });
  if (!res.ok) {
    throw new ApiError(res.status, "download", `下载失败 (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
