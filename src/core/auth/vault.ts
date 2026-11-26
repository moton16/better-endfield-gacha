import fs from "node:fs";
import path from "node:path";
import { dpapi, type SecretCrypto } from "./dpapi.js";
import type { Provider } from "./passport.js";

export interface VaultEntryMeta {
  id: string;
  provider: Provider;
  label: string;
  createdAt: number;
}

interface VaultFile {
  version: 1;
  entries: Array<VaultEntryMeta & { cipher: string }>;
}

/** 通行证 hytoken 保险库：DPAPI 加密落盘（vault.json，位于数据目录，已 gitignore）。 */
export class Vault {
  private file: string;

  constructor(
    dataDir: string,
    private crypto: SecretCrypto = dpapi,
  ) {
    this.file = path.join(dataDir, "vault.json");
  }

  private read(): VaultFile {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, "utf8")) as VaultFile;
      if (j.version === 1 && Array.isArray(j.entries)) return j;
    } catch {
      // 不存在或损坏 → 视为空
    }
    return { version: 1, entries: [] };
  }

  private write(v: VaultFile): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(v, null, 2), "utf8");
  }

  save(id: string, provider: Provider, token: string, label = ""): void {
    const v = this.read();
    v.entries = v.entries.filter((e) => e.id !== id);
    v.entries.push({ id, provider, label, createdAt: Date.now(), cipher: this.crypto.encrypt(token) });
    this.write(v);
  }

  list(): VaultEntryMeta[] {
    return this.read().entries.map(({ cipher: _c, ...m }) => m);
  }

  load(id: string): { provider: Provider; token: string } | null {
    const e = this.read().entries.find((x) => x.id === id);
    return e ? { provider: e.provider, token: this.crypto.decrypt(e.cipher) } : null;
  }

  /** 清除全部已保存会话（并删除文件）。注意：服务端会话仍需在 user.hypergryph.com 手动登出。 */
  clear(): number {
    const n = this.read().entries.length;
    fs.rmSync(this.file, { force: true });
    return n;
  }
}
