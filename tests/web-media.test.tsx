// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act, cleanup, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LCX_BUILTIN_ITEMS, LCX_BUILTIN_POOLS } from "../src/core/data/lcx-catalog.js";
import type { PoolGroup } from "../src/web/api/types.js";
import { Avatar, bannerFor as avatarBannerFor, iconFor as avatarIconFor, MiniItemTile } from "../src/web/components/Avatar.js";
import { PoolSection } from "../src/web/components/PoolSection.js";
import {
  bannerFor,
  iconFor,
  listAvatarPresets,
  listOperatorAvatars,
  normalizeManifest,
  resetMediaManifestForTest,
  resolveAccountAvatarUrl,
  setMediaManifestForTest,
} from "../src/web/lib/media.js";

function makePoolGroup(overrides: Partial<PoolGroup> = {}): PoolGroup {
  return {
    key: "char:E_CharacterGachaPoolType_Special:special_1_0_1",
    kind: "char",
    tab: "limited",
    poolType: "E_CharacterGachaPoolType_Special",
    poolId: "special_1_0_1",
    title: "熔火灼痕",
    total: 20,
    paid: 20,
    free: 0,
    count6: 1,
    count5: 2,
    count4: 17,
    up6Ids: ["chr_0016_laevat"],
    upKnown: true,
    hits: [
      {
        itemId: "chr_0016_laevat",
        itemName: "莱万汀",
        pity: 20,
        isFree: false,
        isNew: true,
        isUp: true,
        gachaTs: "1760000090000",
        seqId: "1001",
        tone: "yellow",
        luck: null,
      },
    ],
    pending: 0,
    smallPityMax: 80,
    freeBatches: [],
    isCurrent: true,
    firstTs: "1760000000000",
    lastTs: "1760000090000",
    ...overrides,
  };
}

beforeEach(() => {
  resetMediaManifestForTest();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetMediaManifestForTest();
});

describe("media manifest & resolution", () => {
  it("re-exports iconFor and bannerFor from Avatar.tsx", () => {
    expect(avatarIconFor).toBe(iconFor);
    expect(avatarBannerFor).toBe(bannerFor);
  });

  it("normalizes empty, array-of-ids, and object-map manifest formats safely", () => {
    const empty = normalizeManifest(null);
    expect(empty.version).toBe(1);
    expect(empty.chars.size).toBe(0);
    expect(empty.weapons.size).toBe(0);
    expect(empty.boxes.size).toBe(0);
    expect(empty.avatars).toEqual([]);
    expect(empty.banners.size).toBe(0);
    expect(empty.itemAlias).toEqual({});

    const fromArrays = normalizeManifest({
      version: 2,
      chars: ["chr_0016_laevat", "chars/chr_0017_yvonne.webp", "../evil", "https://bad/x.webp"],
      weapons: ["./media/weapons/wpn_sword_0006.webp", { id: "wpn_pistol_0010" }],
      boxes: ["box_01", "boxes/box_02.webp"],
      avatars: [
        "preset_01",
        { id: "preset_02", label: "管理员徽章", url: "avatars/preset_02_art.webp" },
      ],
      banners: ["special_1_0_1", "banners/special_1_0_2.webp"],
      itemAlias: {
        _comment: "ignored",
        wpn_box_alias: "boxes/box_01.webp",
        bad_traversal: "../../etc/passwd",
        bad_http: "https://evil.example/a.webp",
      },
    });

    expect(fromArrays.version).toBe(2);
    expect([...fromArrays.chars]).toEqual(["chr_0016_laevat", "chr_0017_yvonne"]);
    expect([...fromArrays.weapons]).toEqual(["wpn_sword_0006", "wpn_pistol_0010"]);
    expect([...fromArrays.boxes]).toEqual(["box_01", "box_02"]);
    expect(fromArrays.avatars).toEqual([
      {
        id: "preset_01",
        url: "./media/avatars/preset_01.webp",
        mediaKey: "media/avatars/preset_01.webp",
      },
      {
        id: "preset_02",
        label: "管理员徽章",
        url: "./media/avatars/preset_02_art.webp",
        mediaKey: "media/avatars/preset_02_art.webp",
      },
    ]);
    expect(fromArrays.banners.get("special_1_0_1")).toBe("./media/banners/special_1_0_1.webp");
    expect(fromArrays.banners.get("special_1_0_2")).toBe("./media/banners/special_1_0_2.webp");
    expect(fromArrays.itemAlias).toEqual({ wpn_box_alias: "boxes/box_01.webp" });

    const fromMaps = normalizeManifest({
      chars: {
        _note: "ignore",
        chr_0016_laevat: "chars/chr_0016_laevat.webp",
        chr_disabled: false,
      },
      weapons: {
        wpn_sword_0006: "weapons/wpn_sword_0006.webp",
      },
      boxes: {
        box_a: "boxes/box_a.webp",
      },
      avatars: {
        av_01: "avatars/av_01.webp",
        av_02: { label: "终末地", file: "avatars/av_02.webp" },
        av_03: "角色预设",
      },
      banners: {
        _comment: "ignore",
        special_1_0_1: "special_1_0_1.webp",
        special_1_0_2: "banners/special_1_0_2.webp",
        special_1_0_3: "./media/banners/custom_banner.webp",
        standard: "",
      },
    });

    expect([...fromMaps.chars]).toEqual(["chr_0016_laevat"]);
    expect([...fromMaps.weapons]).toEqual(["wpn_sword_0006"]);
    expect([...fromMaps.boxes]).toEqual(["box_a"]);
    expect(fromMaps.avatars).toEqual([
      { id: "av_01", url: "./media/avatars/av_01.webp", mediaKey: "media/avatars/av_01.webp" },
      {
        id: "av_02",
        label: "终末地",
        url: "./media/avatars/av_02.webp",
        mediaKey: "media/avatars/av_02.webp",
      },
      {
        id: "av_03",
        label: "角色预设",
        url: "./media/avatars/av_03.webp",
        mediaKey: "media/avatars/av_03.webp",
      },
    ]);
    expect(fromMaps.banners.get("special_1_0_1")).toBe("./media/banners/special_1_0_1.webp");
    expect(fromMaps.banners.get("special_1_0_2")).toBe("./media/banners/special_1_0_2.webp");
    expect(fromMaps.banners.get("special_1_0_3")).toBe("./media/banners/custom_banner.webp");
    expect(fromMaps.banners.has("standard")).toBe(false);
  });

  it("enforces manifest existence check and resolves chars, weapons, and boxes", () => {
    expect(iconFor("chr_0016_laevat")).toBeNull();
    expect(iconFor("")).toBeNull();

    setMediaManifestForTest({
      chars: ["chr_0016_laevat"],
      weapons: ["wpn_sword_0006"],
      boxes: ["box_std_01"],
    });

    expect(iconFor("chr_0016_laevat")).toBe("./media/chars/chr_0016_laevat.webp");
    expect(iconFor("wpn_sword_0006")).toBe("./media/weapons/wpn_sword_0006.webp");
    expect(iconFor("box_std_01")).toBe("./media/boxes/box_std_01.webp");
    expect(iconFor("chr_missing")).toBeNull();
    expect(iconFor("wpn_missing")).toBeNull();
  });

  it("applies Rule A (0008 <-> 0010 swap) without double-swap when itemAlias overrides", () => {
    // 默认互换（itemAlias 未显式覆盖）
    setMediaManifestForTest({
      weapons: ["wpn_funnel_0008", "wpn_funnel_0010"],
    });
    expect(iconFor("wpn_funnel_0008")).toBe("./media/weapons/wpn_funnel_0010.webp");
    expect(iconFor("wpn_funnel_0010")).toBe("./media/weapons/wpn_funnel_0008.webp");

    // 仅存在其中一个时，绝不返回错误/缺失文件名导致 404
    setMediaManifestForTest({
      weapons: ["wpn_funnel_0008"],
    });
    expect(iconFor("wpn_funnel_0008")).toBeNull();
    expect(iconFor("wpn_funnel_0010")).toBe("./media/weapons/wpn_funnel_0008.webp");

    // itemAlias 显式映射时直接使用目标（绝不二次互换）
    setMediaManifestForTest({
      weapons: ["wpn_funnel_0008", "wpn_funnel_0010"],
      itemAlias: {
        wpn_funnel_0008: "wpn_funnel_0010",
        wpn_funnel_0010: "weapons/wpn_funnel_0010.webp",
      },
    });
    expect(iconFor("wpn_funnel_0008")).toBe("./media/weapons/wpn_funnel_0010.webp");
    expect(iconFor("wpn_funnel_0010")).toBe("./media/weapons/wpn_funnel_0010.webp");

    setMediaManifestForTest({
      weapons: ["wpn_funnel_0008", "wpn_funnel_0010"],
      itemAlias: {
        wpn_funnel_0008: "wpn_funnel_0008",
      },
    });
    expect(iconFor("wpn_funnel_0008")).toBe("./media/weapons/wpn_funnel_0008.webp");
    expect(iconFor("wpn_funnel_0010")).toBe("./media/weapons/wpn_funnel_0008.webp");
  });

  it("applies Rule B (宏愿 wpn_sword_0021 <-> wpn_sword_0021_ink bidirectional fallback)", () => {
    setMediaManifestForTest({
      weapons: ["wpn_sword_0021_ink"],
    });
    expect(iconFor("wpn_sword_0021")).toBe("./media/weapons/wpn_sword_0021_ink.webp");
    expect(iconFor("wpn_sword_0021_ink")).toBe("./media/weapons/wpn_sword_0021_ink.webp");

    setMediaManifestForTest({
      weapons: ["wpn_sword_0021"],
    });
    expect(iconFor("wpn_sword_0021")).toBe("./media/weapons/wpn_sword_0021.webp");
    expect(iconFor("wpn_sword_0021_ink")).toBe("./media/weapons/wpn_sword_0021.webp");

    setMediaManifestForTest({
      weapons: ["wpn_sword_0021", "wpn_sword_0021_ink"],
    });
    expect(iconFor("wpn_sword_0021")).toBe("./media/weapons/wpn_sword_0021.webp");
    expect(iconFor("wpn_sword_0021_ink")).toBe("./media/weapons/wpn_sword_0021_ink.webp");

    setMediaManifestForTest({ weapons: [] });
    expect(iconFor("wpn_sword_0021")).toBeNull();
    expect(iconFor("wpn_sword_0021_ink")).toBeNull();
  });

  it("applies Rule C (补给箱 multi-ID dedup via itemAlias)", () => {
    setMediaManifestForTest({
      boxes: ["box_weapon_shared"],
      itemAlias: {
        wpn_gift_box_1: "box_weapon_shared",
        wpn_gift_box_2: "boxes/box_weapon_shared",
        wpn_gift_box_3: "boxes/box_weapon_shared.webp",
        wpn_gift_box_missing: "boxes/box_nonexistent.webp",
      },
    });

    expect(iconFor("wpn_gift_box_1")).toBe("./media/boxes/box_weapon_shared.webp");
    expect(iconFor("wpn_gift_box_2")).toBe("./media/boxes/box_weapon_shared.webp");
    expect(iconFor("wpn_gift_box_3")).toBe("./media/boxes/box_weapon_shared.webp");
    expect(iconFor("box_weapon_shared")).toBe("./media/boxes/box_weapon_shared.webp");
    expect(iconFor("wpn_gift_box_missing")).toBeNull();
  });

  it("resolves bannerFor only for mapped pools and returns null for standard/beginner/unmapped", () => {
    setMediaManifestForTest({
      banners: {
        special_1_0_1: "special_1_0_1.webp",
        weponbox_1_0_1: "banners/weponbox_1_0_1.webp",
      },
    });

    expect(bannerFor("special_1_0_1")).toBe("./media/banners/special_1_0_1.webp");
    expect(bannerFor("weponbox_1_0_1")).toBe("./media/banners/weponbox_1_0_1.webp");
    expect(bannerFor("standard")).toBeNull();
    expect(bannerFor("beginner")).toBeNull();
    expect(bannerFor("weaponbox_constant_1")).toBeNull();
  });

  it("lists avatar presets/operators and validates resolveAccountAvatarUrl", () => {
    setMediaManifestForTest({
      chars: ["chr_0016_laevat"],
      avatars: [{ id: "endfield_emblem", label: "终末地徽章" }],
    });

    expect(listAvatarPresets()).toEqual([
      {
        id: "endfield_emblem",
        label: "终末地徽章",
        url: "./media/avatars/endfield_emblem.webp",
        mediaKey: "media/avatars/endfield_emblem.webp",
      },
    ]);
    expect(listOperatorAvatars()).toEqual([
      {
        id: "chr_0016_laevat",
        url: "./media/chars/chr_0016_laevat.webp",
        mediaKey: "media/chars/chr_0016_laevat.webp",
      },
    ]);

    // 存在的预设 / 干员头像
    expect(resolveAccountAvatarUrl("media/avatars/endfield_emblem.webp")).toBe(
      "./media/avatars/endfield_emblem.webp",
    );
    expect(resolveAccountAvatarUrl("./media/avatars/endfield_emblem.webp")).toBe(
      "./media/avatars/endfield_emblem.webp",
    );
    expect(resolveAccountAvatarUrl("media/chars/chr_0016_laevat.webp")).toBe(
      "./media/chars/chr_0016_laevat.webp",
    );
    expect(resolveAccountAvatarUrl("./media/chars/chr_0016_laevat.webp")).toBe(
      "./media/chars/chr_0016_laevat.webp",
    );

    // 不在 manifest 中的资源返回 null
    expect(resolveAccountAvatarUrl("media/avatars/missing.webp")).toBeNull();
    expect(resolveAccountAvatarUrl("media/chars/chr_missing.webp")).toBeNull();

    // 合法光栅 DataURL（<= 64 KB）
    const pngData = "data:image/png;base64,iVBORw0KGgo=";
    const jpegData = "data:image/jpeg;base64,/9j/4AAQ";
    const webpData = "data:image/webp;base64,UklGRh4=";
    expect(resolveAccountAvatarUrl(pngData)).toBe(pngData);
    expect(resolveAccountAvatarUrl(jpegData)).toBe(jpegData);
    expect(resolveAccountAvatarUrl(webpData)).toBe(webpData);

    // 超限 DataURL、SVG XSS、外链、路径穿越一律拒绝
    const oversized = `data:image/png;base64,${"A".repeat(64 * 1024)}`;
    expect(resolveAccountAvatarUrl(oversized)).toBeNull();
    expect(resolveAccountAvatarUrl("data:image/svg+xml;base64,PHN2Zy8+")).toBeNull();
    expect(resolveAccountAvatarUrl("https://example.com/a.png")).toBeNull();
    expect(resolveAccountAvatarUrl("media/avatars/../secret.webp")).toBeNull();
    expect(resolveAccountAvatarUrl("")).toBeNull();
  });
});

describe("Avatar, MiniItemTile & PoolSection manifest integration", () => {
  it("renders initial/gradient fallbacks when manifest is empty, and images/banners when present", () => {
    const { container, rerender } = render(
      <div>
        <Avatar name="莱万汀" rarity={6} itemId="chr_0016_laevat" isUp />
        <MiniItemTile name="莱万汀" rarity={6} itemId="chr_0016_laevat" size="xs" />
        <PoolSection group={makePoolGroup()} />
        <PoolSection
          group={makePoolGroup({
            key: "char:E_CharacterGachaPoolType_Standard:standard",
            tab: "standard",
            poolType: "E_CharacterGachaPoolType_Standard",
            poolId: "standard",
            title: "基础寻访",
            up6Ids: [],
            upKnown: false,
          })}
        />
      </div>,
    );

    expect(container.querySelectorAll("img").length).toBe(0);
    const poolHeads = container.querySelectorAll(".pool-head");
    expect(poolHeads.length).toBe(2);
    expect((poolHeads[0] as HTMLElement).style.backgroundImage).toBe("");
    expect((poolHeads[1] as HTMLElement).style.backgroundImage).toBe("");

    act(() => {
      setMediaManifestForTest({
        chars: ["chr_0016_laevat"],
        banners: {
          special_1_0_1: "special_1_0_1.webp",
        },
      });
    });

    rerender(
      <div>
        <Avatar name="莱万汀" rarity={6} itemId="chr_0016_laevat" isUp />
        <MiniItemTile name="莱万汀" rarity={6} itemId="chr_0016_laevat" size="xs" />
        <PoolSection group={makePoolGroup()} />
        <PoolSection
          group={makePoolGroup({
            key: "char:E_CharacterGachaPoolType_Standard:standard",
            tab: "standard",
            poolType: "E_CharacterGachaPoolType_Standard",
            poolId: "standard",
            title: "基础寻访",
            up6Ids: [],
            upKnown: false,
          })}
        />
      </div>,
    );

    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.length).toBeGreaterThanOrEqual(3);
    for (const img of imgs) {
      expect(img.getAttribute("src")).toBe("./media/chars/chr_0016_laevat.webp");
    }

    const updatedHeads = container.querySelectorAll(".pool-head");
    expect((updatedHeads[0] as HTMLElement).style.backgroundImage).toContain(
      "./media/banners/special_1_0_1.webp",
    );
    expect((updatedHeads[1] as HTMLElement).style.backgroundImage).toBe("");
  });

  it("loads ./media/manifest.json once on mount and silently ignores fetch errors", async () => {
    const fetchOk = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "./media/manifest.json") {
        return new Response(
          JSON.stringify({
            version: 1,
            chars: ["chr_0016_laevat"],
            banners: { special_1_0_1: "special_1_0_1.webp" },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchOk);

    const { container } = render(
      <div>
        <Avatar name="莱万汀" rarity={6} itemId="chr_0016_laevat" isUp />
        <PoolSection group={makePoolGroup()} />
      </div>,
    );

    await waitFor(() => {
      const imgs = container.querySelectorAll("img.avatar");
      expect(imgs.length).toBe(2);
      expect(imgs[0]?.getAttribute("src")).toBe("./media/chars/chr_0016_laevat.webp");
      expect(imgs[1]?.getAttribute("src")).toBe("./media/chars/chr_0016_laevat.webp");
      expect(container.querySelectorAll("img.mini-tile-img").length).toBe(1);
    });
    expect(fetchOk).toHaveBeenCalledTimes(1);
    const head = container.querySelector(".pool-head") as HTMLElement;
    expect(head.style.backgroundImage).toContain("./media/banners/special_1_0_1.webp");

    // 运行时 <img> error 事件应优雅退回首字色块
    const firstImg = container.querySelector("img.avatar")!;
    await act(async () => {
      firstImg.dispatchEvent(new Event("error"));
    });
    expect(container.querySelectorAll("img.avatar").length).toBe(1);
    expect(screen.getByText("莱")).toBeTruthy();

    // 失败场景静默回退（不产生未捕获拒绝，不渲染 <img>）
    cleanup();
    resetMediaManifestForTest();
    const fetchErr = vi.fn(async () => {
      throw new TypeError("Failed to parse URL from ./media/manifest.json");
    });
    vi.stubGlobal("fetch", fetchErr);

    const res2 = render(<Avatar name="莱万汀" rarity={6} itemId="chr_0016_laevat" isUp />);
    await waitFor(() => {
      expect(fetchErr).toHaveBeenCalledTimes(1);
    });
    expect(res2.container.querySelectorAll("img").length).toBe(0);
    expect(screen.getByText("莱")).toBeTruthy();
  });
});

interface RawRealManifest {
  version: number;
  chars: string[];
  weapons: string[];
  boxes: string[];
  avatars: Array<{ id: string; label: string; file: string }>;
  banners: Record<string, string>;
  itemAlias: Record<string, string>;
}

function listFilesRecursive(dir: string, rootDir = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, rootDir));
    } else {
      out.push(path.relative(rootDir, full).split(path.sep).join("/"));
    }
  }
  return out.sort();
}

function isWebpFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const buf = fs.readFileSync(filePath);
  return (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

describe("real media pack manifest verification", () => {
  const mediaDir = path.resolve("src/web/public/media");
  const manifestPath = path.join(mediaDir, "manifest.json");

  it("contains zero http(s) URLs, valid WebP files for every entry, and no unused files", () => {
    const rawText = fs.readFileSync(manifestPath, "utf8");
    expect(rawText).not.toMatch(/https?:\/\//i);

    const raw = JSON.parse(rawText) as RawRealManifest;
    expect(raw.version).toBe(1);
    expect(raw.chars).toHaveLength(35);
    expect(raw.weapons).toHaveLength(86);
    expect(raw.boxes).toHaveLength(46);
    expect(raw.avatars).toHaveLength(59);
    expect(Object.keys(raw.banners)).toHaveLength(19);

    const expectedFiles = new Set<string>(["manifest.json"]);

    for (const id of raw.chars) {
      const rel = `chars/${id}.webp`;
      expectedFiles.add(rel);
      expect(isWebpFile(path.join(mediaDir, rel)), `missing/invalid ${rel}`).toBe(true);
    }
    for (const id of raw.weapons) {
      const rel = `weapons/${id}.webp`;
      expectedFiles.add(rel);
      expect(isWebpFile(path.join(mediaDir, rel)), `missing/invalid ${rel}`).toBe(true);
    }
    for (const id of raw.boxes) {
      const rel = `boxes/${id}.webp`;
      expectedFiles.add(rel);
      expect(isWebpFile(path.join(mediaDir, rel)), `missing/invalid ${rel}`).toBe(true);
    }
    for (const av of raw.avatars) {
      expect(av.label.trim().length).toBeGreaterThan(0);
      const rel = `avatars/${av.file}.webp`;
      expectedFiles.add(rel);
      expect(isWebpFile(path.join(mediaDir, rel)), `missing/invalid ${rel}`).toBe(true);
    }
    for (const [poolId, filename] of Object.entries(raw.banners)) {
      expect(filename.endsWith(".webp"), `banner ${poolId} must be .webp`).toBe(true);
      const rel = `banners/${filename}`;
      expectedFiles.add(rel);
      expect(isWebpFile(path.join(mediaDir, rel)), `missing/invalid ${rel}`).toBe(true);
    }
    for (const [aliasId, target] of Object.entries(raw.itemAlias)) {
      const rel = `${target}.webp`;
      expect(fs.existsSync(path.join(mediaDir, rel)), `missing alias target ${aliasId} -> ${rel}`).toBe(
        true,
      );
    }

    const actualFiles = listFilesRecursive(mediaDir);
    expect(actualFiles).toEqual([...expectedFiles].sort());
    expect(actualFiles.filter((f) => f.endsWith(".webp"))).toHaveLength(241);
  });

  it("resolves high-risk weapons, box aliases, LCX built-in catalog, and character/weapon pool banners", () => {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as RawRealManifest;
    setMediaManifestForTest(raw);

    // High-risk weapon IDs
    expect(iconFor("wpn_funnel_0008")).toBe("./media/weapons/wpn_funnel_0010.webp");
    expect(iconFor("wpn_funnel_0010")).toBe("./media/weapons/wpn_funnel_0008.webp");
    expect(iconFor("wpn_sword_0021")).toBe("./media/weapons/wpn_sword_0021.webp");
    expect(iconFor("wpn_sword_0021_ink")).toBe("./media/weapons/wpn_sword_0021.webp");

    // Supply box aliases (deduplicated 57 -> 46)
    expect(iconFor("item_case_wpn_selfselect_1")).toBe("./media/boxes/item_case_pick.webp");
    expect(iconFor("item_case_wpn_selfselect_gahca_1_0_1")).toBe(
      "./media/boxes/item_case_wpn_selfselect_gahca_0_1.webp",
    );
    expect(iconFor("item_case_wpn_selfselect_gahca_c_1")).toBe(
      "./media/boxes/item_case_wpn_selfselect_gahca_c_2.webp",
    );
    expect(iconFor("item_case_wpn_selfselect_gahca_c_4")).toBe(
      "./media/boxes/item_case_wpn_selfselect_gahca_c_1.webp",
    );
    for (const [aliasId, target] of Object.entries(raw.itemAlias)) {
      if (target.startsWith("boxes/")) {
        expect(iconFor(aliasId)).toBe(`./media/${target}.webp`);
      }
    }

    // 100% of LCX_BUILTIN_ITEMS chars & weapons resolve to real on-disk WebP assets
    for (const [name, itemId] of Object.entries(LCX_BUILTIN_ITEMS.char)) {
      const url = iconFor(itemId);
      expect(url, `LCX char ${name} (${itemId})`).toMatch(/^\.\/media\/chars\/.+\.webp$/);
      expect(fs.existsSync(path.join(mediaDir, url!.replace(/^\.\/media\//, "")))).toBe(true);
    }
    for (const [name, itemId] of Object.entries(LCX_BUILTIN_ITEMS.weapon)) {
      const url = iconFor(itemId);
      expect(url, `LCX weapon ${name} (${itemId})`).toMatch(/^\.\/media\/weapons\/.+\.webp$/);
      expect(fs.existsSync(path.join(mediaDir, url!.replace(/^\.\/media\//, "")))).toBe(true);
    }

    // All 19 character pools resolve to banners; standard/beginner/weapon pools return null
    const expectedCharPools = [
      "special_1_0_1",
      "special_1_0_2",
      "special_1_0_3",
      "special_1_1_1",
      "special_1_1_2",
      "special_1_2_1",
      "joint_1_2_2",
      "special_1_3_1",
      "special_1_3_2",
      "special_1_4_1",
      "special_1_4_2",
      "special_1_5_1",
      "rerun_chr_yvonne",
      "special_1_6_1",
      "rerun_chr_tangtang",
      "special_1_6_2",
      "special_1_7_1",
      "rerun_chr_aglina",
      "rerun_chr_wulfa",
    ];
    for (const poolId of expectedCharPools) {
      const url = bannerFor(poolId);
      expect(url, `banner for ${poolId}`).toMatch(/^\.\/media\/banners\/.+\.webp$/);
      expect(fs.existsSync(path.join(mediaDir, url!.replace(/^\.\/media\//, "")))).toBe(true);
    }
    expect(bannerFor("standard")).toBeNull();
    expect(bannerFor("beginner")).toBeNull();
    for (const entry of Object.values(LCX_BUILTIN_POOLS)) {
      if (entry.feed.startsWith("weapon:")) {
        expect(bannerFor(entry.poolId), `weapon pool ${entry.poolId}`).toBeNull();
      }
    }

    // All avatar presets & operator avatars resolve cleanly
    const presets = listAvatarPresets();
    expect(presets).toHaveLength(59);
    for (const p of presets) {
      expect(resolveAccountAvatarUrl(p.mediaKey)).toBe(p.url);
    }
    const operators = listOperatorAvatars();
    expect(operators).toHaveLength(35);
    for (const op of operators) {
      expect(resolveAccountAvatarUrl(op.mediaKey)).toBe(op.url);
    }
  });
});
