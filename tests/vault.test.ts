import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dpapi, type SecretCrypto } from "../src/core/auth/dpapi.js";
import { Vault } from "../src/core/auth/vault.js";

const fakeCrypto: SecretCrypto = {
  encrypt: (plain) => `ENC:${Buffer.from(plain, "utf8").toString("base64")}`,
  decrypt: (cipher) => Buffer.from(cipher.slice(4), "base64").toString("utf8"),
};

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beg-vault-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("Vault（合成加解密）", () => {
  it("save/list/load/clear 流程正常且 list() 不包含 cipher 字段", () => {
    withTempDir((dir) => {
      const v = new Vault(dir, fakeCrypto);
      const tok = "SYNTH_HYTOKEN_VAULT_001";
      v.save("id_a", "hypergryph", tok, "主号");

      const list = v.list();
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe("id_a");
      expect(list[0]?.provider).toBe("hypergryph");
      expect(list[0]?.label).toBe("主号");
      expect("cipher" in list[0]!).toBe(false);

      expect(v.load("id_a")).toEqual({ provider: "hypergryph", token: tok });
      expect(v.load("missing")).toBeNull();

      expect(v.clear()).toBe(1);
      expect(fs.existsSync(path.join(dir, "vault.json"))).toBe(false);
      expect(v.list()).toEqual([]);
      expect(v.clear()).toBe(0);
    });
  });

  it("重复 id 覆盖旧条目", () => {
    withTempDir((dir) => {
      const v = new Vault(dir, fakeCrypto);
      v.save("same", "hypergryph", "TOKEN_OLD_0001");
      v.save("same", "gryphline", "TOKEN_NEW_0002", "覆盖");

      const list = v.list();
      expect(list).toHaveLength(1);
      expect(list[0]?.provider).toBe("gryphline");
      expect(list[0]?.label).toBe("覆盖");
      expect(v.load("same")).toEqual({ provider: "gryphline", token: "TOKEN_NEW_0002" });
    });
  });

  it("损坏或版本不匹配的 vault.json 视为空", () => {
    withTempDir((dir) => {
      const file = path.join(dir, "vault.json");
      fs.writeFileSync(file, "{broken json", "utf8");
      const v = new Vault(dir, fakeCrypto);
      expect(v.list()).toEqual([]);
      expect(v.load("any")).toBeNull();

      fs.writeFileSync(file, JSON.stringify({ version: 99, entries: [{ id: "x" }] }), "utf8");
      expect(v.list()).toEqual([]);
    });
  });
});

describe.skipIf(process.platform !== "win32")("Vault（Windows 真实 DPAPI）", () => {
  it("dpapi 加密落盘与解密往返，且 vault.json 不含明文 token", () => {
    withTempDir((dir) => {
      const v = new Vault(dir, dpapi);
      const tok = "SYNTH_REAL_DPAPI_TEST_TOKEN_987654321";
      v.save("dpapi_1", "hypergryph", tok);

      const raw = fs.readFileSync(path.join(dir, "vault.json"), "utf8");
      expect(raw).not.toContain(tok);
      expect(v.load("dpapi_1")).toEqual({ provider: "hypergryph", token: tok });
      expect(v.clear()).toBe(1);
    });
  });
});
