import { useEffect, useState } from "preact/hooks";

export interface AvatarPreset {
  id: string;
  label?: string;
  url: string;
  mediaKey: string;
}

export interface MediaManifest {
  version: number;
  chars: Set<string>;
  weapons: Set<string>;
  boxes: Set<string>;
  currency: Set<string>;
  avatars: AvatarPreset[];
  banners: Map<string, string>;
  itemAlias: Record<string, string>;
}

type MediaCategory = "chars" | "weapons" | "boxes" | "currency" | "avatars" | "banners";

const MAX_DATA_URL_BYTES = 64 * 1024;
const SAFE_STEM_RE = /^[A-Za-z0-9_.-]+$/;
const RASTER_DATA_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MEDIA_AVATAR_PATH_RE = /^media\/(avatars|chars)\/([A-Za-z0-9_.-]+)\.webp$/;

/** 官方包里爆破单元(0008)与骑士精神(0010)图标文件名互换 */
const FUNNEL_SWAP: Readonly<Record<string, string>> = {
  wpn_funnel_0008: "wpn_funnel_0010",
  wpn_funnel_0010: "wpn_funnel_0008",
};

/** 宏愿双版本图标双向回退 */
const SWORD_ALIAS: Readonly<Record<string, string>> = {
  wpn_sword_0021: "wpn_sword_0021_ink",
  wpn_sword_0021_ink: "wpn_sword_0021",
};

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSafeStem(stem: string): boolean {
  return stem.length > 0 && !stem.includes("..") && SAFE_STEM_RE.test(stem);
}

function stripMediaRoot(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.includes("..") || s.includes("\\") || /^[a-z]+:/i.test(s)) {
    return null;
  }
  return s.replace(/^\.?\//, "").replace(/^media\//, "");
}

function stripWebpExt(s: string): string {
  return s.toLowerCase().endsWith(".webp") ? s.slice(0, -5) : s;
}

function stripCategoryStem(raw: string, category: MediaCategory): string | null {
  let rel = stripMediaRoot(raw);
  if (!rel) return null;
  const prefix = `${category}/`;
  if (rel.startsWith(prefix)) {
    rel = rel.slice(prefix.length);
  }
  const stem = stripWebpExt(rel);
  return isSafeStem(stem) ? stem : null;
}

function stripAnyCategoryStem(raw: string): string | null {
  let rel = stripMediaRoot(raw);
  if (!rel) return null;
  for (const cat of ["chars/", "weapons/", "boxes/", "currency/", "avatars/", "banners/"] as const) {
    if (rel.startsWith(cat)) {
      rel = rel.slice(cat.length);
      break;
    }
  }
  const stem = stripWebpExt(rel);
  return isSafeStem(stem) ? stem : null;
}

function createEmptyManifest(): MediaManifest {
  return {
    version: 1,
    chars: new Set<string>(),
    weapons: new Set<string>(),
    boxes: new Set<string>(),
    currency: new Set<string>(),
    avatars: [],
    banners: new Map<string, string>(),
    itemAlias: {},
  };
}

function normalizeIdSet(
  raw: unknown,
  category: "chars" | "weapons" | "boxes" | "currency",
): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const candidate =
        typeof item === "string"
          ? item
          : isPlainObject(item) && typeof item.id === "string"
            ? item.id
            : null;
      if (!candidate) continue;
      const stem = stripCategoryStem(candidate, category);
      if (stem) out.add(stem);
    }
    return out;
  }
  if (isPlainObject(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith("_")) continue;
      if (v === false || v === null || v === undefined || v === "") continue;
      if (typeof v === "string" && stripMediaRoot(v) === null) continue;
      const stem = stripCategoryStem(k, category);
      if (stem) out.add(stem);
    }
  }
  return out;
}

function buildAvatarPreset(id: string, fileStem: string, label?: string): AvatarPreset {
  return {
    id,
    ...(label ? { label } : {}),
    url: `./media/avatars/${fileStem}.webp`,
    mediaKey: `media/avatars/${fileStem}.webp`,
  };
}

function normalizeAvatars(raw: unknown): AvatarPreset[] {
  const byId = new Map<string, AvatarPreset>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        const id = stripCategoryStem(item, "avatars");
        if (id && !byId.has(id)) {
          byId.set(id, buildAvatarPreset(id, id));
        }
      } else if (isPlainObject(item) && typeof item.id === "string") {
        const id = stripCategoryStem(item.id, "avatars");
        if (!id || byId.has(id)) continue;
        const fileCandidate =
          typeof item.url === "string"
            ? item.url
            : typeof item.mediaKey === "string"
              ? item.mediaKey
              : typeof item.file === "string"
                ? item.file
                : id;
        const fileStem = stripCategoryStem(fileCandidate, "avatars") ?? id;
        const label =
          typeof item.label === "string" && item.label.trim() ? item.label.trim() : undefined;
        byId.set(id, buildAvatarPreset(id, fileStem, label));
      }
    }
    return [...byId.values()];
  }

  if (isPlainObject(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith("_")) continue;
      if (v === false || v === null || v === undefined || v === "") continue;
      const id = stripCategoryStem(k, "avatars");
      if (!id || byId.has(id)) continue;

      if (typeof v === "string") {
        const trimmed = v.trim();
        const looksLikePath =
          trimmed.includes("/") || trimmed.toLowerCase().endsWith(".webp") || trimmed === id;
        if (looksLikePath) {
          const fileStem = stripCategoryStem(trimmed, "avatars");
          if (fileStem) {
            byId.set(id, buildAvatarPreset(id, fileStem));
          }
        } else {
          byId.set(id, buildAvatarPreset(id, id, trimmed));
        }
      } else if (isPlainObject(v)) {
        const fileCandidate =
          typeof v.url === "string"
            ? v.url
            : typeof v.mediaKey === "string"
              ? v.mediaKey
              : typeof v.file === "string"
                ? v.file
                : id;
        const fileStem = stripCategoryStem(fileCandidate, "avatars") ?? id;
        const label = typeof v.label === "string" && v.label.trim() ? v.label.trim() : undefined;
        byId.set(id, buildAvatarPreset(id, fileStem, label));
      } else if (v === true) {
        byId.set(id, buildAvatarPreset(id, id));
      }
    }
  }

  return [...byId.values()];
}

function normalizeBanners(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const stem = stripCategoryStem(item, "banners");
      if (stem) {
        out.set(stem, `./media/banners/${stem}.webp`);
      }
    }
    return out;
  }

  if (isPlainObject(raw)) {
    for (const [poolIdRaw, v] of Object.entries(raw)) {
      const poolId = poolIdRaw.trim();
      if (!poolId || poolId.startsWith("_") || poolId.includes("..")) continue;
      if (v === false || v === null || v === undefined || v === "") continue;
      const stem =
        v === true
          ? stripCategoryStem(poolId, "banners")
          : typeof v === "string"
            ? stripCategoryStem(v, "banners")
            : null;
      if (stem) {
        out.set(poolId, `./media/banners/${stem}.webp`);
      }
    }
  }
  return out;
}

function normalizeItemAlias(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isPlainObject(raw)) return out;
  for (const [kRaw, v] of Object.entries(raw)) {
    const k = kRaw.trim();
    if (!k || k.startsWith("_")) continue;
    if (typeof v !== "string") continue;
    const cleaned = stripMediaRoot(v);
    if (!cleaned) continue;
    // 验证目标格式合法（或为安全 stem 或为 chars/weapons/boxes 子路径）
    if (
      cleaned.startsWith("chars/") ||
      cleaned.startsWith("weapons/") ||
      cleaned.startsWith("boxes/") ||
      cleaned.startsWith("currency/")
    ) {
      const cat = cleaned.slice(0, cleaned.indexOf("/")) as
        | "chars"
        | "weapons"
        | "boxes"
        | "currency";
      if (!stripCategoryStem(cleaned, cat)) continue;
    } else if (!isSafeStem(stripWebpExt(cleaned))) {
      continue;
    }
    out[k] = cleaned;
  }
  return out;
}

export function normalizeManifest(raw: unknown): MediaManifest {
  if (!isPlainObject(raw)) {
    return createEmptyManifest();
  }
  const version =
    typeof raw.version === "number" && Number.isFinite(raw.version) && raw.version > 0
      ? Math.floor(raw.version)
      : 1;
  return {
    version,
    chars: normalizeIdSet(raw.chars, "chars"),
    weapons: normalizeIdSet(raw.weapons, "weapons"),
    boxes: normalizeIdSet(raw.boxes, "boxes"),
    currency: normalizeIdSet(raw.currency, "currency"),
    avatars: normalizeAvatars(raw.avatars),
    banners: normalizeBanners(raw.banners),
    itemAlias: normalizeItemAlias(raw.itemAlias),
  };
}

let currentManifest: MediaManifest = createEmptyManifest();
let loadState: "idle" | "loading" | "loaded" | "test" = "idle";
let loadPromise: Promise<void> | null = null;
let manifestGen = 0;
const listeners = new Set<(m: MediaManifest) => void>();

function notifyListeners(): void {
  for (const fn of listeners) {
    fn(currentManifest);
  }
}

async function ensureManifestLoaded(): Promise<void> {
  if (loadState !== "idle") return loadPromise ?? undefined;
  if (typeof fetch !== "function") {
    loadState = "loaded";
    return;
  }

  loadState = "loading";
  const gen = manifestGen;
  loadPromise = (async () => {
    try {
      const res = await fetch("./media/manifest.json");
      if (!res || !res.ok) return;
      const raw: unknown = await res.json();
      if (gen !== manifestGen) return;
      currentManifest = normalizeManifest(raw);
      loadState = "loaded";
      notifyListeners();
    } catch {
      // jsdom / 离线无资源包时静默回退为空 manifest，避免控制台未捕获异常或 404 噪音
    } finally {
      if (gen === manifestGen && loadState === "loading") {
        loadState = "loaded";
      }
      if (gen === manifestGen) {
        loadPromise = null;
      }
    }
  })();

  return loadPromise;
}

export function useMediaManifest(): MediaManifest {
  const [manifest, setManifest] = useState<MediaManifest>(currentManifest);

  useEffect(() => {
    listeners.add(setManifest);
    if (currentManifest !== manifest) {
      setManifest(currentManifest);
    }
    if (loadState === "idle") {
      void ensureManifestLoaded();
    }
    return () => {
      listeners.delete(setManifest);
    };
  }, []);

  return manifest;
}

function resolveTarget(manifest: MediaManifest, target: string): string | null {
  const rel = stripMediaRoot(target);
  if (!rel) return null;

  if (rel.startsWith("chars/")) {
    const stem = stripCategoryStem(rel, "chars");
    return stem && manifest.chars.has(stem) ? `./media/chars/${stem}.webp` : null;
  }
  if (rel.startsWith("weapons/")) {
    const stem = stripCategoryStem(rel, "weapons");
    return stem && manifest.weapons.has(stem) ? `./media/weapons/${stem}.webp` : null;
  }
  if (rel.startsWith("boxes/")) {
    const stem = stripCategoryStem(rel, "boxes");
    return stem && manifest.boxes.has(stem) ? `./media/boxes/${stem}.webp` : null;
  }
  if (rel.startsWith("currency/")) {
    const stem = stripCategoryStem(rel, "currency");
    return stem && manifest.currency.has(stem) ? `./media/currency/${stem}.webp` : null;
  }

  const stem = stripWebpExt(rel);
  if (!isSafeStem(stem)) return null;
  if (manifest.chars.has(stem)) return `./media/chars/${stem}.webp`;
  if (manifest.weapons.has(stem)) return `./media/weapons/${stem}.webp`;
  if (manifest.boxes.has(stem)) return `./media/boxes/${stem}.webp`;
  if (manifest.currency.has(stem)) return `./media/currency/${stem}.webp`;
  return null;
}

export function currencyIconFor(itemId: string): string | null {
  const id = typeof itemId === "string" ? itemId.trim() : "";
  if (!id) return null;
  const stem = stripCategoryStem(id, "currency");
  if (!stem) return null;
  return currentManifest.currency.has(stem) ? `./media/currency/${stem}.webp` : null;
}

export function iconFor(itemId: string): string | null {
  const id = typeof itemId === "string" ? itemId.trim() : "";
  if (!id) return null;

  const manifest = currentManifest;

  // 显式 itemAlias 优先（支持多 ID 补给箱去重，且避免与 0008<->0010 默认互换发生二次反转）
  if (hasOwn(manifest.itemAlias, id)) {
    const target = manifest.itemAlias[id]!;
    const resolved = resolveTarget(manifest, target);
    if (resolved) return resolved;

    const stem = stripAnyCategoryStem(target);
    if (stem && hasOwn(SWORD_ALIAS, stem) && !target.includes("/")) {
      const alt = SWORD_ALIAS[stem]!;
      if (manifest.weapons.has(alt)) {
        return `./media/weapons/${alt}.webp`;
      }
    }
    return null;
  }

  // Rule A: 爆破单元(wpn_funnel_0008) <-> 骑士精神(wpn_funnel_0010) 图标互换
  if (hasOwn(FUNNEL_SWAP, id)) {
    const swapped = FUNNEL_SWAP[id]!;
    return manifest.weapons.has(swapped) ? `./media/weapons/${swapped}.webp` : null;
  }

  // Rule B: 宏愿 wpn_sword_0021 <-> wpn_sword_0021_ink 双向回退
  if (hasOwn(SWORD_ALIAS, id)) {
    if (manifest.weapons.has(id)) {
      return `./media/weapons/${id}.webp`;
    }
    const alt = SWORD_ALIAS[id]!;
    return manifest.weapons.has(alt) ? `./media/weapons/${alt}.webp` : null;
  }

  // 常规存在性校验：chars -> weapons -> boxes
  return resolveTarget(manifest, id);
}

export function bannerFor(poolId: string): string | null {
  const id = typeof poolId === "string" ? poolId.trim() : "";
  if (!id) return null;
  return currentManifest.banners.get(id) ?? null;
}

export function listAvatarPresets(): AvatarPreset[] {
  return [...currentManifest.avatars];
}

export function listOperatorAvatars(): AvatarPreset[] {
  return [...currentManifest.chars].map((id) => ({
    id,
    url: `./media/chars/${id}.webp`,
    mediaKey: `media/chars/${id}.webp`,
  }));
}

export function resolveAccountAvatarUrl(avatar?: string): string | null {
  if (typeof avatar !== "string") return null;
  const trimmed = avatar.trim();
  if (!trimmed) return null;

  if (RASTER_DATA_URL_RE.test(trimmed)) {
    return trimmed.length <= MAX_DATA_URL_BYTES ? trimmed : null;
  }

  const rel = trimmed.replace(/^\.?\//, "");
  const match = MEDIA_AVATAR_PATH_RE.exec(rel);
  if (!match) return null;
  const group = match[1] as "avatars" | "chars";
  const stem = match[2]!;
  if (!isSafeStem(stem)) return null;

  if (group === "avatars") {
    const mediaKey = `media/avatars/${stem}.webp`;
    const preset =
      currentManifest.avatars.find((a) => a.mediaKey === mediaKey) ??
      currentManifest.avatars.find((a) => a.id === stem);
    return preset ? preset.url : null;
  }

  return currentManifest.chars.has(stem) ? `./media/chars/${stem}.webp` : null;
}

export function setMediaManifestForTest(raw: unknown): void {
  manifestGen += 1;
  loadState = "test";
  loadPromise = null;
  currentManifest = normalizeManifest(raw);
  notifyListeners();
}

export function resetMediaManifestForTest(): void {
  manifestGen += 1;
  loadState = "idle";
  loadPromise = null;
  currentManifest = createEmptyManifest();
  notifyListeners();
}
