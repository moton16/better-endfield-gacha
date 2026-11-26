/**
 * 测试辅助：合成鹰角通行证服务端（oauth grant / binding_list / u8_token_by_uid / QR 登录）。
 * 数据全部虚构，不访问真实网络。
 */
export interface FakePassportData {
  hytoken: string;
  expectedAppCode?: string;
  /** appCode 为 endfield 的绑定 */
  bindings: Array<{
    uid: string;
    channelMasterId: string | number;
    channelName: string;
    isDeleted?: boolean;
    isDefault?: boolean;
    roles: Array<{ roleId: string; nickName: string; serverId?: string; serverName?: string }>;
    /** 该绑定对应的 u8_token（测试里每个绑定不同） */
    u8Token: string;
  }>;
  /** 额外塞一个别的游戏条目，验证不会误取 list[0] */
  includeOtherGame?: boolean;
  /** 第几次 scan_status 轮询返回 scanCode（默认第 1 次）；<= 0 表示永远未确认 */
  qrConfirmAtPoll?: number;
  qrToken?: string;
  /** 覆盖特定路径的响应（返回 undefined 则走默认逻辑） */
  override?: (url: URL, body: any) => Response | undefined;
}

export function createFakePassport(d: FakePassportData) {
  const calls: Array<{ url: URL; body?: any }> = [];
  let scanPolls = 0;
  let seq = 0;
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

  const f = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });

    const custom = d.override?.(url, body);
    if (custom) return custom;

    if (url.pathname === "/user/oauth2/v2/grant") {
      const appCode = d.expectedAppCode ?? "be36d44aa36bfb5b";
      if (body?.type !== 1 || body?.token !== d.hytoken || body?.appCode !== appCode) {
        return json({ status: 3, msg: "bad grant" });
      }
      return json({ status: 0, data: { token: `OAUTH-SYNTH-${++seq}` } });
    }
    if (url.pathname === "/account/binding/v1/binding_list") {
      if (!url.searchParams.get("token")?.startsWith("OAUTH-SYNTH-")) return json({ status: 3, msg: "bad oauth" });
      const list: unknown[] = [];
      if (d.includeOtherGame) {
        list.push({
          appCode: "arknights",
          bindingList: [{ uid: "OTHER-ARK-UID", channelMasterId: 1, channelName: "官服", roles: [{ roleId: "OTHER_ROLE", nickName: "博士" }] }],
        });
      }
      list.push({
        appCode: "endfield",
        bindingList: d.bindings.map((b) => ({
          uid: b.uid,
          channelMasterId: b.channelMasterId,
          channelName: b.channelName,
          isDeleted: !!b.isDeleted,
          isDefault: !!b.isDefault,
          roles: b.roles.map((r) => ({
            roleId: r.roleId,
            nickName: r.nickName,
            serverId: r.serverId ?? "1",
            serverName: r.serverName ?? "China",
          })),
        })),
      });
      return json({ status: 0, data: { list } });
    }
    if (url.pathname === "/account/binding/v1/u8_token_by_uid") {
      if (!String(body?.token ?? "").startsWith("OAUTH-SYNTH-")) return json({ status: 3, msg: "bad oauth" });
      const b = d.bindings.find((x) => x.uid === body?.uid);
      // 关键断言点：传 roleId 必须失败（真实服务端返回 109）
      if (!b) return json({ status: 109, msg: "uid not found" });
      return json({ status: 0, data: { token: b.u8Token } });
    }
    if (url.pathname === "/general/v1/gen_scan/login") {
      return json({
        status: 0,
        data: { scanId: "SCAN-SYNTH-1", scanUrl: "https://example.invalid/scan/SYNTH-1" },
      });
    }
    if (url.pathname === "/general/v1/scan_status") {
      scanPolls++;
      const target = d.qrConfirmAtPoll ?? 1;
      if (target > 0 && scanPolls >= target && url.searchParams.get("scanId") === "SCAN-SYNTH-1") {
        return json({ status: 0, data: { scanCode: "SCANCODE-SYNTH-OK" } });
      }
      return json({ status: 100, msg: "waiting scan" });
    }
    if (url.pathname === "/user/auth/v1/token_by_scan_code") {
      if (body?.scanCode !== "SCANCODE-SYNTH-OK") return json({ status: 3, msg: "bad scanCode" });
      return json({ status: 0, data: { token: d.qrToken ?? d.hytoken } });
    }
    return json({ status: 404, msg: "unknown passport endpoint" }, 404);
  }) as typeof fetch;

  return { fetch: f, calls };
}
