import { useState } from "preact/hooks";
import { setKey } from "../api/client.js";

function extractKey(raw: string): string {
  const trimmed = raw.trim();
  const m = /[#&]k=([^&]+)/.exec(trimmed);
  if (m && m[1]) {
    try {
      return decodeURIComponent(m[1]).trim();
    } catch {
      return m[1].trim();
    }
  }
  return trimmed;
}

export function KeyPrompt({
  reason,
  onSubmit,
}: {
  reason: string;
  onSubmit: () => void;
}) {
  const [value, setValue] = useState("");

  function handleSubmit(e: Event) {
    e.preventDefault();
    const key = extractKey(value);
    setValue("");
    if (!key) return;
    setKey(key);
    onSubmit();
  }

  return (
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="key-prompt-title">
        <div class="modal-head">
          <h2 id="key-prompt-title">需要访问密钥</h2>
        </div>
        <p class="muted">{reason}</p>
        <form onSubmit={handleSubmit}>
          <div class="field">
            <label htmlFor="beg-key-input">粘贴启动密钥（或含 #k= 的完整地址）</label>
            <input
              id="beg-key-input"
              class="input"
              type="password"
              autocomplete="off"
              placeholder="输入 X-BEG-Key"
              value={value}
              onInput={(e) => setValue((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="row-inline">
            <button type="submit" class="btn primary" disabled={!value.trim()}>
              解锁并加载
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
