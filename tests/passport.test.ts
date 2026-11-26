import { describe, expect, it } from "vitest";
import {
  grantOAuth,
  listBindings,
  normalizeBindings,
  parseHyTokenInput,
  PassportError,
  PROVIDERS,
  qrCreate,
  qrPoll,
  qrWait,
  u8TokenByUid,
} from "../src/core/auth/passport.js";
import { createFakePassport } from "./helpers/fake-passport.js";

const noSleep = async () => {};
const fakeHy = "HYTOKEN_SYNTH_0123456789abcdef";

describe("parseHyTokenInput", () => {
  it("支持纯 token、/account/info/hg JSON 与带引号和 URL 编码输入", () => {
    expect(parseHyTokenInput(fakeHy)).toBe(fakeHy);
    expect(parseHyTokenInput(`  "${fakeHy}"  `)).toBe(fakeHy);
    expect(parseHyTokenInput(`'${fakeHy}'`)).toBe(fakeHy);
    expect(parseHyTokenInput(JSON.stringify({ code: 0, data: { content: fakeHy } }))).toBe(fakeHy);
    expect(parseHyTokenInput(JSON.stringify({ status: 0, data: { token: fakeHy } }))).toBe(fakeHy);
    expect(parseHyTokenInput(encodeURIComponent("HYTOKEN+SYNTH/012345=="))).toBe("HYTOKEN+SYNTH/012345==");
  });

  it("拒绝空串、短串、空格串、坏 JSON 与非法百分号编码", () => {
    expect(parseHyTokenInput("")).toBeNull();
    expect(parseHyTokenInput("short")).toBeNull();
    expect(parseHyTokenInput("not a token with spaces")).toBeNull();
    expect(parseHyTokenInput("{bad json")).toBeNull();
    expect(parseHyTokenInput(JSON.stringify({ code: 0, data: {} }))).toBeNull();
    expect(parseHyTokenInput("HYTOKEN%ZZBAD_0123456789")).toBeNull();
  });
});

describe("grantOAuth 与状态字段校验", () => {
  it("请求体含 type=1 与对应 appCode（cn/global）", async () => {
    const cnSrv = createFakePassport({ hytoken: fakeHy, expectedAppCode: PROVIDERS.hypergryph.appCode, bindings: [] });
    const oauthCn = await grantOAuth(fakeHy, "hypergryph", cnSrv.fetch);
    expect(oauthCn).toMatch(/^OAUTH-SYNTH-/);
    expect(cnSrv.calls[0]?.body).toEqual({ type: 1, appCode: "be36d44aa36bfb5b", token: fakeHy });

    const glSrv = createFakePassport({ hytoken: fakeHy, expectedAppCode: PROVIDERS.gryphline.appCode, bindings: [] });
    const oauthGl = await grantOAuth(fakeHy, "gryphline", glSrv.fetch);
    expect(oauthGl).toMatch(/^OAUTH-SYNTH-/);
    expect(glSrv.calls[0]?.body).toEqual({ type: 1, appCode: "3dacefa138426cfe", token: fakeHy });
  });

  it("仅认 status===0，返回 {code:0} 时应当失败", async () => {
    const srv = createFakePassport({
      hytoken: fakeHy,
      bindings: [],
      override: () =>
        new Response(JSON.stringify({ code: 0, data: { token: "SHOULD_NOT_ACCEPT" } }), {
          headers: { "content-type": "application/json" },
        }),
    });
    const err = await grantOAuth(fakeHy, "hypergryph", srv.fetch).catch((e) => e);
    expect(err).toBeInstanceOf(PassportError);
    expect((err as PassportError).stage).toBe("grant");
  });

  it("HTTP 错误、非 JSON 响应与缺少 token 字段均抛出 PassportError", async () => {
    const httpErr = (async () => new Response("err", { status: 502 })) as typeof fetch;
    await expect(grantOAuth(fakeHy, "hypergryph", httpErr)).rejects.toThrow(/HTTP 502/);

    const badJson = (async () => new Response("not-json", { status: 200 })) as typeof fetch;
    await expect(grantOAuth(fakeHy, "hypergryph", badJson)).rejects.toThrow(/响应不是 JSON/);

    const noTok = createFakePassport({
      hytoken: fakeHy,
      bindings: [],
      override: () => new Response(JSON.stringify({ status: 0, data: {} }), { headers: { "content-type": "application/json" } }),
    });
    await expect(grantOAuth(fakeHy, "hypergryph", noTok.fetch)).rejects.toThrow(/缺少 token/);
  });
});

describe("normalizeBindings", () => {
  it("统一 channelMasterId 为字符串、跳过别的游戏与缺 uid 条目", () => {
    const out = normalizeBindings({
      list: [
        { appCode: "arknights", bindingList: [{ uid: "ARK1", channelMasterId: 1, roles: [{ roleId: "R_ARK" }] }] },
        {
          appCode: "endfield",
          bindingList: [
            { uid: "", channelMasterId: 1, roles: [{ roleId: "MISSING_UID" }] },
            {
              uid: "B_UID_1",
              channelMasterId: 2,
              channelName: "bilibili服",
              isDefault: true,
              roles: [{ roleId: "ROLE_1", nickName: "测一", serverId: 1 }, { roleId: "" }],
            },
            {
              uid: "B_UID_2",
              channelMasterId: "1",
              channelName: "官服",
              roles: [{ roleId: "ROLE_2", nickname: "测二", serverId: "1" }],
            },
          ],
        },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.uid).toBe("B_UID_1");
    expect(out[0]?.channelMasterId).toBe("2");
    expect(out[0]?.roles).toHaveLength(1);
    expect(out[0]?.roles[0]?.serverId).toBe("1");
    expect(out[1]?.channelMasterId).toBe("1");
    expect(out[1]?.roles[0]?.nickname).toBe("测二");
  });
});

describe("u8TokenByUid", () => {
  it("传 roleId 返回 status=109 抛出 PassportError，传外层 binding.uid 成功", async () => {
    const srv = createFakePassport({
      hytoken: fakeHy,
      bindings: [
        {
          uid: "BIND_UID_999",
          channelMasterId: 2,
          channelName: "bilibili服",
          roles: [{ roleId: "ROLE_ID_888", nickName: "测试" }],
          u8Token: "U8_SYNTH_OK",
        },
      ],
    });
    const oauth = await grantOAuth(fakeHy, "hypergryph", srv.fetch);
    const err = await u8TokenByUid(oauth, "ROLE_ID_888", "hypergryph", srv.fetch).catch((e) => e);
    expect(err).toBeInstanceOf(PassportError);
    expect((err as PassportError).status).toBe(109);

    const token = await u8TokenByUid(oauth, "BIND_UID_999", "hypergryph", srv.fetch);
    expect(token).toBe("U8_SYNTH_OK");
  });
});

describe("扫码登录（QR）", () => {
  it("qrPoll 未确认及网络/HTTP 异常时返回 null", async () => {
    const srv = createFakePassport({ hytoken: fakeHy, bindings: [], qrConfirmAtPoll: 3 });
    const session = await qrCreate(srv.fetch);
    expect(session.scanId).toBe("SCAN-SYNTH-1");
    expect(await qrPoll(session.scanId, srv.fetch)).toBeNull();
    expect(await qrPoll(session.scanId, srv.fetch)).toBeNull();

    const netErr = (async () => {
      throw new Error("timeout");
    }) as typeof fetch;
    expect(await qrPoll(session.scanId, netErr)).toBeNull();

    const httpErr = (async () => new Response("err", { status: 503 })) as typeof fetch;
    expect(await qrPoll(session.scanId, httpErr)).toBeNull();
  });

  it("qrWait 在第 3 次轮询返回 scanCode 后换取 token；超时抛错", async () => {
    const srvWait = createFakePassport({ hytoken: fakeHy, bindings: [], qrConfirmAtPoll: 3, qrToken: "QR_HY_SYNTH_TOKEN" });
    const s2 = await qrCreate(srvWait.fetch);
    const tok = await qrWait(s2, { f: srvWait.fetch, sleep: noSleep, timeoutMs: 10_000, intervalMs: 100 });
    expect(tok).toBe("QR_HY_SYNTH_TOKEN");
    expect(srvWait.calls.filter((c) => c.url.pathname === "/general/v1/scan_status")).toHaveLength(3);

    const srvTimeout = createFakePassport({ hytoken: fakeHy, bindings: [], qrConfirmAtPoll: 0 });
    const s3 = await qrCreate(srvTimeout.fetch);
    const err = await qrWait(s3, { f: srvTimeout.fetch, sleep: noSleep, timeoutMs: 300, intervalMs: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(PassportError);
    expect((err as PassportError).stage).toBe("scan_status");
  });
});

describe("错误消息脱敏（scrubUrl）", () => {
  it("listBindings 网络异常中带 token 参数时错误消息必须抹掉 token", async () => {
    const secretOauth = "OAUTH_SECRET_LEAK_CHECK_12345";
    const failingFetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      throw new Error(`request failed for ${url}`);
    }) as typeof fetch;

    const err = await listBindings(secretOauth, "hypergryph", failingFetch).catch((e) => e);
    expect(err).toBeInstanceOf(PassportError);
    expect(String((err as Error).message)).not.toContain(secretOauth);
    expect(String((err as Error).message)).toContain("token=<redacted>");
  });
});
