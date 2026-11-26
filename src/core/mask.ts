import { fingerprint } from "./redact.js";

/** 终端与本地 API 默认脱敏账号键（region_channel_#<hash>），show=true 才返回明文。 */
export function maskKey(key: string, show = false): string {
  if (show) return key;
  const [region, channel, ...rest] = key.split("_");
  return `${region}_${channel}_#${fingerprint(rest.join("_"))}`;
}
