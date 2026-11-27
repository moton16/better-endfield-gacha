import { maskKey } from "../../core/mask.js";
import { HttpError, type Router } from "../http.js";
import type { AppDeps } from "../index.js";

const MAX_AVATAR_BYTES = 64 * 1024;
/** 预留 JSON 包装字节，确保 64 KB DataURL 能完整解析后再精确返回 400 bad_avatar */
const AVATAR_BODY_LIMIT = 128 * 1024;
const AVATAR_MEDIA_RE = /^media\/(?:avatars|chars)\/[A-Za-z0-9_.-]+\.webp$/;
const AVATAR_DATA_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

interface AvatarBody {
  avatar?: unknown;
}

function validateAvatar(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new HttpError(400, "avatar 必须是字符串", "bad_avatar");
  }
  if (raw === "") return "";
  if (AVATAR_MEDIA_RE.test(raw) && !raw.includes("..")) {
    return raw;
  }
  if (raw.startsWith("data:")) {
    if (Buffer.byteLength(raw, "utf8") > MAX_AVATAR_BYTES) {
      throw new HttpError(400, "头像 DataURL 超过 64 KB 上限", "bad_avatar");
    }
    if (AVATAR_DATA_URL_RE.test(raw)) {
      return raw;
    }
    throw new HttpError(400, "仅支持 PNG/JPEG/WebP 格式的 base64 DataURL", "bad_avatar");
  }
  throw new HttpError(400, "头像格式非法（仅支持空串、本地 media/avatars|chars/*.webp 或不超过 64 KB 的光栅 DataURL）", "bad_avatar");
}

export function register(router: Router, deps: AppDeps): void {
  router.get("/api/accounts", () => {
    const avatars = deps.store.getAccountAvatars();
    return deps.store.listAccounts().map((a) => {
      const c = deps.store.countRecords(a.accountKey);
      return {
        accountKey: a.accountKey,
        maskedKey: maskKey(a.accountKey, false),
        region: a.region,
        channelName: a.channelName,
        nickname: a.nickname,
        source: a.source,
        updatedAt: a.updatedAt,
        counts: { total: c.total, draws: c.draws },
        avatar: avatars.get(a.accountKey) ?? "",
      };
    });
  });

  router.add("PUT", "/api/accounts/:key/avatar", async (c) => {
    const key = c.params.key!;
    if (!deps.store.getAccount(key)) {
      throw new HttpError(404, "账号不存在", "not_found");
    }
    const body = await c.json<AvatarBody>(AVATAR_BODY_LIMIT);
    const avatar = validateAvatar(body.avatar);
    deps.store.setAccountAvatar(key, avatar);
    return { accountKey: key, avatar };
  });
}
