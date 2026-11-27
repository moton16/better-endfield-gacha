import accountsSample from "../mock/accounts.json";
import analysisSample from "../mock/analysis.sample.json";
import syncJobSample from "../mock/sync-job.json";
import type {
  AccountAnalysis,
  AccountAvatarResponse,
  AccountSummary,
  CacheScanResponse,
  ImportResponse,
  PassportInspectResponse,
  PassportQrCreateResponse,
  PassportQrStatusResponse,
  SyncJob,
  VaultSession,
} from "./types.js";

export function isMock(): boolean {
  return new URLSearchParams(location.search).has("mock");
}

const DEFAULT_MOCK_VAULT: VaultSession = {
  id: "aabbccdd",
  provider: "hypergryph",
  label: "bilibili服 · 1角色",
  createdAt: 1760000010000,
};

const MAX_AVATAR_BYTES = 64 * 1024;
const MEDIA_AVATAR_RE = /^media\/(?:avatars|chars)\/[A-Za-z0-9_.-]+\.webp$/;
const RASTER_DATA_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function isValidMockAvatar(avatar: string): boolean {
  if (avatar === "") return true;
  if (MEDIA_AVATAR_RE.test(avatar) && !avatar.includes("..")) return true;
  if (
    RASTER_DATA_URL_RE.test(avatar) &&
    new TextEncoder().encode(avatar).length <= MAX_AVATAR_BYTES
  ) {
    return true;
  }
  return false;
}

let mockJobPolls = 0;
let mockQrSeq = 0;
const mockQrSessions = new Map<string, { save: boolean; polls: number }>();
let mockVault: VaultSession[] = [{ ...DEFAULT_MOCK_VAULT }];
const mockAvatars = new Map<string, string>();

export function resetMockState(): void {
  mockJobPolls = 0;
  mockQrSeq = 0;
  mockQrSessions.clear();
  mockVault = [{ ...DEFAULT_MOCK_VAULT }];
  mockAvatars.clear();
}

const analysisAccountB: AccountAnalysis = {
  accountKey: "cn_1_SYNTHUID002_SYNTHROLE002",
  generatedAt: 1760000100000,
  overview: {
    limited: {
      total: 85,
      count6: 1,
      offBanner: 0,
      upCount: 1,
      avgPity6: 50,
      avgCostPerUp: 85,
      badges: [],
      luckCounts: { ou: 0, fei: 0 },
    },
    weapon: {
      total: 0,
      count6: 0,
      offBanner: 0,
      upCount: 0,
      avgPity6: null,
      avgCostPerUp: null,
      badges: [],
      luckCounts: { ou: 0, fei: 0 },
    },
    standard: {
      total: 0,
      count6: 0,
      offBanner: 0,
      upCount: 0,
      avgPity6: null,
      avgCostPerUp: null,
      badges: [],
      luckCounts: { ou: 0, fei: 0 },
    },
    beginner: {
      total: 0,
      count6: 0,
      offBanner: 0,
      upCount: 0,
      avgPity6: null,
      avgCostPerUp: null,
      badges: [],
      luckCounts: { ou: 0, fei: 0 },
    },
  },
  global: {
    totalDraws: 85,
    totalFree: 0,
    totalNonDraw: 0,
    total6: 1,
    firstRecordTs: "1760000010000",
    globalBadges: [],
    globalLuckCounts: { ou: 0, fei: 0 },
    avgPity6: 50,
    ratingLabel: "《小有欧气》",
    isLucky: true,
  },
  groups: [
    {
      key: "char:E_CharacterGachaPoolType_Special:special_synth_b",
      kind: "char",
      tab: "limited",
      poolType: "E_CharacterGachaPoolType_Special",
      poolId: "special_synth_b",
      title: "合成官服特许池",
      total: 85,
      paid: 85,
      free: 0,
      count6: 1,
      count5: 9,
      count4: 75,
      up6Ids: ["chr_synth_up_b"],
      upKnown: true,
      hits: [
        {
          itemId: "chr_synth_up_b",
          itemName: "干员09",
          pity: 50,
          isFree: false,
          isNew: true,
          isUp: true,
          gachaTs: "1760000050000",
          seqId: "9050",
          tone: "yellow",
          luck: null,
          subHits5: [
            { itemId: "chr_5_b_1", itemName: "干员五甲", count: 3 },
            { itemId: "chr_5_b_2", itemName: "干员五乙", count: 2 },
          ],
        },
      ],
      pending: 35,
      pendingSubHits5: [
        { itemId: "chr_5_b_1", itemName: "干员五甲", count: 2 },
        { itemId: "chr_5_b_3", itemName: "干员五丙", count: 2 },
      ],
      smallPityMax: 80,
      bigPity: {
        max: 120,
        count: 85,
        remaining: 0,
        gotUp: true,
        fromOfficialCount: false,
      },
      freeBatches: [],
      isCurrent: true,
      firstTs: "1760000010000",
      lastTs: "1760000050000",
    },
  ],
  notes: [],
};

export async function mockFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const [pathname] = path.split("?");

  if (pathname === "/api/health") {
    return { ok: true, version: "0.1.0-mock" } as T;
  }

  if (pathname === "/api/accounts") {
    const list = (accountsSample as AccountSummary[]).map((a) => ({
      ...a,
      avatar: mockAvatars.get(a.accountKey) ?? a.avatar ?? "",
    }));
    return list as T;
  }

  if (pathname?.startsWith("/api/accounts/") && pathname.endsWith("/avatar") && method === "PUT") {
    const key = decodeURIComponent(
      pathname.slice("/api/accounts/".length, -"/avatar".length),
    );
    const exists = (accountsSample as AccountSummary[]).some((a) => a.accountKey === key);
    if (!exists) {
      throw new Error("账号不存在");
    }
    const body = (init.body ?? {}) as { avatar?: unknown };
    if (typeof body.avatar !== "string" || !isValidMockAvatar(body.avatar)) {
      throw new Error("头像格式无效或超过 64 KB 限制");
    }
    mockAvatars.set(key, body.avatar);
    const res: AccountAvatarResponse = { accountKey: key, avatar: body.avatar };
    return res as T;
  }

  if (pathname?.startsWith("/api/accounts/") && pathname.endsWith("/analysis")) {
    const key = decodeURIComponent(
      pathname.slice("/api/accounts/".length, -"/analysis".length),
    );
    if (key === "cn_1_SYNTHUID002_SYNTHROLE002") {
      return analysisAccountB as T;
    }
    return (analysisSample as AccountAnalysis) as T;
  }

  if (pathname === "/api/cache/scan") {
    const res: CacheScanResponse = {
      locations: [
        {
          dir: "X:\\synthetic\\PlatformProcess\\Cache",
          backend: "blockfile",
          origin: "qtwebengine",
        },
      ],
      credentials: [
        {
          fingerprint: "11aa22bb",
          host: "ef-webview.hypergryph.com",
          channel: "2",
          subChannel: "2",
          serverId: "1",
          sortTime: Date.now() - 12 * 60_000,
          paths: ["/page/gacha_char"],
        },
      ],
      errors: [],
    };
    return res as T;
  }

  if (pathname === "/api/link" && method === "POST") {
    const body = (init.body ?? {}) as { copy?: boolean; reveal?: boolean };
    const masked =
      "https://ef-webview.hypergryph.com/page/gacha_char?channel=2&subChannel=2&platform=Windows&lang=zh-cn&server=1&u8_token=<LEN=328, SHA256_PREFIX=11aa22bb>";
    return {
      masked,
      ...(body.copy ? { copied: true } : {}),
      ...(body.reveal
        ? {
            link: "https://ef-webview.hypergryph.com/page/gacha_char?channel=2&server=1&u8_token=SYNTH_DEMO_TOKEN_NOT_REAL",
          }
        : {}),
    } as T;
  }

  if (pathname === "/api/passport/inspect" && method === "POST") {
    const body = (init.body ?? {}) as { save?: boolean; provider?: string };
    const res: PassportInspectResponse = {
      bindings: [
        {
          channelName: "bilibili服",
          channelMasterId: "2",
          roleCount: 1,
          isDefault: true,
          uidFingerprint: "11aa22bb",
        },
        {
          channelName: "官服",
          channelMasterId: "1",
          roleCount: 1,
          isDefault: false,
          uidFingerprint: "33cc44dd",
        },
      ],
      ...(body.save ? { vaultId: "aabbccdd" } : {}),
    };
    if (body.save) {
      const entry: VaultSession = {
        id: "aabbccdd",
        provider: body.provider === "gryphline" ? "gryphline" : "hypergryph",
        label: "bilibili服 · 1角色",
        createdAt: Date.now(),
      };
      mockVault = [entry, ...mockVault.filter((v) => v.id !== "aabbccdd")];
    }
    return res as T;
  }

  if (pathname === "/api/passport/qr" && method === "POST") {
    const body = (init.body ?? {}) as { provider?: string; save?: boolean };
    if (body.provider === "gryphline") {
      throw new Error("国际服暂不支持扫码登录，请使用通行证 token");
    }
    mockQrSeq += 1;
    const scanId = `SYNTHSCAN${String(mockQrSeq).padStart(23, "0")}`;
    mockQrSessions.set(scanId, { save: body.save !== false, polls: 0 });
    const res: PassportQrCreateResponse = {
      scanId,
      scanUrl: `hypergryph://scan_login?scanId=${scanId}`,
    };
    return res as T;
  }

  if (pathname?.startsWith("/api/passport/qr/") && method === "GET") {
    const scanId = decodeURIComponent(pathname.slice("/api/passport/qr/".length));
    const session = mockQrSessions.get(scanId);
    if (!session) {
      throw new Error("扫码会话不存在或已过期，请重新生成二维码");
    }
    session.polls += 1;
    if (session.polls === 1) {
      const pending: PassportQrStatusResponse = { status: "pending" };
      return pending as T;
    }
    const label = "bilibili服 · 1角色";
    const bindings = [
      {
        channelName: "bilibili服",
        channelMasterId: "2",
        roleCount: 1,
        isDefault: true,
        uidFingerprint: "11aa22bb",
      },
    ];
    let vaultId: string | undefined;
    if (session.save) {
      vaultId = "eeff0011";
      const entry: VaultSession = {
        id: vaultId,
        provider: "hypergryph",
        label,
        createdAt: Date.now(),
      };
      mockVault = [entry, ...mockVault.filter((v) => v.id !== vaultId)];
    }
    const confirmed: PassportQrStatusResponse = {
      status: "confirmed",
      ...(vaultId ? { vaultId } : {}),
      label,
      bindings,
    };
    return confirmed as T;
  }

  if (pathname === "/api/passport/vault" && method === "GET") {
    return mockVault as T;
  }

  if (pathname === "/api/passport/vault" && method === "DELETE") {
    const cleared = mockVault.length;
    mockVault = [];
    return { cleared } as T;
  }

  if (pathname === "/api/sync" && method === "POST") {
    mockJobPolls = 0;
    return { jobId: "mock" } as T;
  }

  if (pathname === "/api/jobs/mock") {
    mockJobPolls += 1;
    if (mockJobPolls === 1) {
      const running: SyncJob = {
        id: "mock",
        kind: "sync",
        state: "running",
        progress: ["使用缓存凭据 11aa22bb（qtwebengine）", "拉取 特许寻访 …"],
        startedAt: 1760000000000,
      };
      return running as T;
    }
    return (syncJobSample as SyncJob) as T;
  }

  if (pathname === "/api/import" && method === "POST") {
    const body = (init.body ?? {}) as { apply?: boolean };
    const res: ImportResponse = {
      plans: [
        {
          maskedKey: "cn_2_#11aa22bb",
          total: 50,
          added: 12,
          duplicates: 38,
          conflicts: 0,
          skipped: 0,
        },
      ],
      warnings: [],
      unresolvedPools: [],
      applied: body.apply === true,
      ...(body.apply === true ? { backup: "gacha-backup-mock.sqlite" } : {}),
    };
    return res as T;
  }

  if (pathname === "/api/backup" && method === "POST") {
    return { file: "gacha-backup-mock.sqlite" } as T;
  }

  if (pathname === "/api/export/save" && method === "POST") {
    const body = (init.body ?? {}) as { format?: string };
    return {
      file: `beg-export-mock.${body.format === "csv" ? "csv" : "json"}`,
      dir: "C:\\mock\\data\\exports",
      bytes: 2048,
      accounts: 1,
      records: 50,
    } as T;
  }

  if (pathname === "/api/open-folder" && method === "POST") {
    return { dir: "C:\\mock\\data" } as T;
  }

  if (pathname === "/api/backups" && method === "GET") {
    return {
      dir: "C:\\mock\\data\\backups",
      files: [{ file: "gacha-backup-mock.sqlite", size: 40960, mtime: 1760000000000 }],
    } as T;
  }

  if (pathname === "/api/backup/restore" && method === "POST") {
    const body = (init.body ?? {}) as { apply?: boolean };
    return {
      plans: [{ maskedKey: "cn_2_#11aa22bb", total: 50, added: 3, duplicates: 47, conflicts: 0, skipped: 0 }],
      warnings: [],
      unresolvedPools: [],
      applied: body.apply === true,
      ...(body.apply === true ? { backup: "gacha-backup-mock-pre.sqlite" } : {}),
    } as T;
  }

  throw new Error(`Mock endpoint not handled: ${method} ${path}`);
}

export async function mockDownload(path: string, filename: string): Promise<void> {
  const isCsv = path.includes("format=csv");
  const content = isCsv
    ? "\uFEFFtype,poolName,itemName,rarity,gachaTs\nchar,合成特许寻访二期,干员02,6,1760000090000\n"
    : JSON.stringify({ format: "better-endfield-gacha/v1", accounts: accountsSample }, null, 2);
  const blob = new Blob([content], {
    type: isCsv ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
  });
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
