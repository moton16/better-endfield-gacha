import { useEffect, useState } from "preact/hooks";
import { maskName } from "../lib/bar.js";
import {
  listAvatarPresets,
  listOperatorAvatars,
  resolveAccountAvatarUrl,
  useMediaManifest,
  type AvatarPreset,
} from "../lib/media.js";

export const MAX_AVATAR_BYTES = 64 * 1024;
const MAX_INPUT_FILE_BYTES = 32 * 1024 * 1024;
const RASTER_DATA_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const CROP_DIMENSIONS = [128, 96, 64, 48] as const;
const ENCODE_TARGETS: ReadonlyArray<
  readonly [mime: "image/webp" | "image/jpeg" | "image/png", qualities: readonly (number | undefined)[]]
> = [
  ["image/webp", [0.88, 0.76, 0.64, 0.5, 0.36]],
  ["image/jpeg", [0.86, 0.72, 0.58, 0.42]],
  ["image/png", [undefined]],
];

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

async function decodeImageBlob(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      if (!bmp || bmp.width <= 0 || bmp.height <= 0) {
        bmp?.close?.();
        throw new Error("无法解析图片尺寸");
      }
      return {
        source: bmp,
        width: bmp.width,
        height: bmp.height,
        cleanup: () => {
          try {
            bmp.close?.();
          } catch {
            // 忽略释放异常
          }
        },
      };
    } catch (err) {
      throw new Error(err instanceof Error && err.message ? err.message : "图片解码失败，请确认文件未损坏");
    }
  }

  if (typeof FileReader === "undefined" || typeof Image === "undefined") {
    throw new Error("当前浏览器不支持图片解码");
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("读取图片失败"));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("图片加载超时")), 8000);
    img.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("无法解码该图片文件"));
    };
    img.src = rawDataUrl;
  });

  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (width <= 0 || height <= 0) {
    throw new Error("无法解析图片尺寸");
  }
  return { source: img, width, height, cleanup: () => {} };
}

/**
 * 将本地图片文件居中裁剪为正方形并缩放压缩为 <= maxBytes 字节的位图 DataURL。
 * 优先尝试 128×128 WebP，超出上限时逐步降低画质与分辨率并回退 JPEG/PNG。
 */
export async function cropImageFileToDataUrl(
  file: Blob,
  maxBytes = MAX_AVATAR_BYTES,
): Promise<string> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error("无效的头像体积上限");
  }
  if (!file || file.size <= 0) {
    throw new Error("请选择非空图片文件");
  }
  if (file.size > MAX_INPUT_FILE_BYTES) {
    throw new Error("所选图片过大（超过 32 MB），请换一张较小的图片");
  }
  const fileName = "name" in file && typeof (file as File).name === "string" ? (file as File).name : "";
  if (file.type === "image/svg+xml" || fileName.toLowerCase().endsWith(".svg")) {
    throw new Error("不支持 SVG 格式，请选择 PNG、JPEG 或 WebP 图片");
  }
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("不支持的文件类型，请选择图片文件");
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("当前环境不支持图片裁剪处理");
  }

  const decoded = await decodeImageBlob(file);
  try {
    const side = Math.min(decoded.width, decoded.height);
    const sx = Math.floor((decoded.width - side) / 2);
    const sy = Math.floor((decoded.height - side) / 2);

    for (const dim of CROP_DIMENSIONS) {
      canvas.width = dim;
      canvas.height = dim;
      for (const [mime, qualities] of ENCODE_TARGETS) {
        ctx.clearRect(0, 0, dim, dim);
        if (mime === "image/jpeg") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, dim, dim);
        }
        ctx.drawImage(decoded.source, sx, sy, side, side, 0, 0, dim, dim);
        for (const q of qualities) {
          const url = q === undefined ? canvas.toDataURL(mime) : canvas.toDataURL(mime, q);
          if (RASTER_DATA_URL_RE.test(url) && utf8ByteLength(url) <= maxBytes) {
            return url;
          }
        }
      }
    }
    throw new Error(`图片压缩后仍超过 ${Math.floor(maxBytes / 1024)} KB 上限，请换一张较小的图片`);
  } finally {
    decoded.cleanup();
  }
}

function AvatarChoiceGrid({
  items,
  currentAvatar,
  busy,
  label,
  onPick,
}: {
  items: AvatarPreset[];
  currentAvatar: string;
  busy: boolean;
  label: string;
  onPick: (mediaKey: string) => void;
}) {
  return (
    <div class="avatar-picker-grid" role="group" aria-label={label}>
      {items.map((item) => {
        const active = currentAvatar === item.mediaKey;
        const name = item.label || item.id;
        return (
          <button
            key={item.mediaKey}
            type="button"
            class={`avatar-choice ${active ? "active" : ""}`}
            aria-pressed={active}
            aria-label={`${label} ${name}`}
            title={name}
            disabled={busy}
            onClick={() => onPick(item.mediaKey)}
          >
            <img class="avatar-choice-img" src={item.url} alt={name} />
          </button>
        );
      })}
    </div>
  );
}

export function AvatarPickerDialog({
  accountKey,
  currentAvatar,
  nickname,
  privacy,
  onSelectAvatar,
  onClose,
}: {
  accountKey: string;
  currentAvatar: string;
  nickname: string;
  privacy: boolean;
  onSelectAvatar: (nextAvatar: string) => Promise<void> | void;
  onClose: () => void;
}) {
  useMediaManifest();
  const presets = listAvatarPresets();
  const operators = listOperatorAvatars();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const previewUrl = !privacy && currentAvatar ? resolveAccountAvatarUrl(currentAvatar) : null;
  const fallbackChar = privacy ? "终" : ([...nickname][0] ?? "终");

  async function applyAvatar(nextAvatar: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSelectAvatar(nextAvatar);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await cropImageFileToDataUrl(file);
      await onSelectAvatar(dataUrl);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="avatar-picker-title">
        <div class="modal-head">
          <h2 id="avatar-picker-title">更换头像</h2>
          <button
            type="button"
            class="btn"
            disabled={busy}
            onClick={onClose}
            aria-label="关闭头像选择弹窗"
          >
            关闭
          </button>
        </div>

        <div class="info-box avatar-picker-preview" data-account-key={accountKey}>
          <div class="header-avatar avatar-picker-thumb" aria-hidden="true">
            <span class="header-avatar-inner">
              {previewUrl ? <img class="header-avatar-img" src={previewUrl} alt="" /> : fallbackChar}
            </span>
          </div>
          <div class="avatar-picker-meta">
            <div class="avatar-picker-name">{maskName(nickname, !privacy)}</div>
            <div class="muted avatar-picker-note">
              {privacy
                ? "隐私遮罩已开启，主界面头像将保持显示「终」"
                : currentAvatar
                  ? "当前已设置自定义头像（按当前账号独立保存）"
                  : "当前使用昵称首字默认头像"}
            </div>
          </div>
        </div>

        <section class="info-box avatar-picker-section">
          <div class="avatar-picker-title">预设头像</div>
          {presets.length === 0 ? (
            <p class="muted avatar-picker-empty">
              当前未装入预设游戏头像资源包，可使用本地图片裁剪上传
            </p>
          ) : (
            <AvatarChoiceGrid
              items={presets}
              currentAvatar={currentAvatar}
              busy={busy}
              label="预设头像"
              onPick={(mediaKey) => void applyAvatar(mediaKey)}
            />
          )}
        </section>

        {operators.length > 0 && (
          <section class="info-box avatar-picker-section">
            <div class="avatar-picker-title">干员头像</div>
            <AvatarChoiceGrid
              items={operators}
              currentAvatar={currentAvatar}
              busy={busy}
              label="干员头像"
              onPick={(mediaKey) => void applyAvatar(mediaKey)}
            />
          </section>
        )}

        <section class="info-box avatar-picker-section">
          <div class="field" style={{ marginBottom: 0 }}>
            <label htmlFor="avatar-file-input">本地图片裁剪上传（自动居中裁剪，上限 64 KB）</label>
            <input
              id="avatar-file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/*"
              disabled={busy}
              onChange={(e) => void handleFileChange(e)}
            />
          </div>
          {busy && <div class="muted avatar-picker-busy">正在处理并保存头像…</div>}
        </section>

        {error && (
          <div class="warn-text" role="alert">
            {error}
          </div>
        )}

        <div class="avatar-picker-actions">
          <button
            type="button"
            class="btn"
            disabled={busy || !currentAvatar}
            onClick={() => void applyAvatar("")}
          >
            恢复默认
          </button>
          <button type="button" class="btn ghost" disabled={busy} onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
