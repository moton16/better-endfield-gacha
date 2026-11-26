import { createHash } from "node:crypto";

/** 把敏感值脱敏为 `<LEN=n, SHA256_PREFIX=xxxxxxxx>`，日志/终端只允许输出这种形式。 */
export function redact(value: string): string {
  const digest = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
  return `<LEN=${value.length}, SHA256_PREFIX=${digest}>`;
}

export function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
}

/** 从任意文本中抹掉 token= / u8_token= 查询参数，用于错误消息。 */
export function scrubUrl(text: string): string {
  return text.replace(/((?:u8_)?token=)[^&\s"'<>]+/gi, "$1<redacted>");
}
