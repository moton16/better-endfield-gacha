import { useState } from "preact/hooks";
import { api, download } from "../api/client.js";
import type { AccountSummary, BackupResponse, ImportResponse } from "../api/types.js";

const MAX_IMPORT_BYTES = 60 * 1024 * 1024;

function sniffLcxText(text: string): boolean {
  const clean = text.startsWith("\uFEFF") ? text.slice(1) : text;
  try {
    const parsed = JSON.parse(clean) as { format?: unknown };
    return !(parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.format === "better-endfield-gacha/v1");
  } catch {
    return false;
  }
}

export function DataDialog({
  accounts,
  currentAccountKey,
  privacy,
  onClose,
  onDataChanged,
  onToast,
  onAuthError,
}: {
  accounts: AccountSummary[];
  currentAccountKey: string;
  privacy: boolean;
  onClose: () => void;
  onDataChanged: () => Promise<void> | void;
  onToast: (msg: string) => void;
  onAuthError: (err: unknown) => boolean;
}) {
  const [exportScope, setExportScope] = useState<"all" | string>(currentAccountKey || "all");
  const [includeGifts, setIncludeGifts] = useState(false);

  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [format, setFormat] = useState<"auto" | "v1" | "lcx">("auto");
  const [targetAccount, setTargetAccount] = useState(currentAccountKey || "");
  const [detectedLcx, setDetectedLcx] = useState(false);
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsAccountForLcx = (format === "lcx" || (format === "auto" && detectedLcx)) && !targetAccount;

  async function handleExport(fmt: "json" | "csv") {
    setError(null);
    const params = new URLSearchParams({ format: fmt });
    if (exportScope !== "all") params.set("account", exportScope);
    if (fmt === "csv") params.set("includeGifts", includeGifts ? "1" : "0");
    try {
      await download(`/api/export?${params.toString()}`, `beg-export.${fmt}`);
      onToast(`已导出 ${fmt.toUpperCase()} 文件`);
    } catch (err) {
      if (onAuthError(err)) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleFileChange(e: Event) {
    setError(null);
    setPreview(null);
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      setFileName("");
      setFileText("");
      setDetectedLcx(false);
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setError("导入文件超过 60 MB 上限");
      setFileName("");
      setFileText("");
      setDetectedLcx(false);
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setFileText(text);
    setDetectedLcx(sniffLcxText(text));
  }

  async function runImport(apply: boolean) {
    if (!fileText.trim()) {
      setError("请先选择导入文件");
      return;
    }
    if (needsAccountForLcx) {
      setError("离愁轩导入必须先选择目标账号");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<ImportResponse>("/api/import", {
        method: "POST",
        body: {
          text: fileText,
          format,
          ...(targetAccount ? { account: targetAccount } : {}),
          apply,
        },
      });
      setPreview(res);
      if (apply) {
        const added = res.plans.reduce((s, p) => s + p.added, 0);
        await onDataChanged();
        onToast(`导入完成，新增 ${added} 条${res.backup ? `（已备份：${res.backup}）` : ""}`);
      }
    } catch (err) {
      if (onAuthError(err)) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleBackup() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<BackupResponse>("/api/backup", { method: "POST", body: {} });
      onToast(`已备份：${res.file}`);
    } catch (err) {
      if (onAuthError(err)) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="data-dialog-title">
        <div class="modal-head">
          <h2 id="data-dialog-title">导入 / 导出 / 备份</h2>
          <button type="button" class="btn" onClick={onClose} aria-label="关闭数据弹窗">
            关闭
          </button>
        </div>

        <section class="info-box">
          <strong>导出记录</strong>
          <div class="field" style={{ marginTop: "6px" }}>
            <label htmlFor="export-scope">导出范围</label>
            <select
              id="export-scope"
              class="select"
              value={exportScope}
              onChange={(e) => setExportScope((e.target as HTMLSelectElement).value)}
            >
              <option value="all">全部账号</option>
              {accounts.map((acc) => (
                <option key={acc.accountKey} value={acc.accountKey}>
                  {acc.channelName} · {privacy ? acc.maskedKey : acc.accountKey.slice(-6)}
                </option>
              ))}
            </select>
          </div>
          <label class="row-inline" style={{ marginBottom: "8px" }}>
            <input
              type="checkbox"
              checked={includeGifts}
              onChange={(e) => setIncludeGifts((e.target as HTMLInputElement).checked)}
            />
            <span>CSV 包含非抽卡赠品（如寻访情报书）</span>
          </label>
          <div class="row-inline">
            <button type="button" class="btn" onClick={() => void handleExport("json")}>
              导出 JSON
            </button>
            <button type="button" class="btn" onClick={() => void handleExport("csv")}>
              导出 CSV
            </button>
            <button type="button" class="btn" disabled={busy} onClick={() => void handleBackup()}>
              立即备份数据库
            </button>
          </div>
        </section>

        <section class="info-box">
          <strong>导入 JSON（先预览，再确认写入）</strong>
          <div class="field" style={{ marginTop: "6px" }}>
            <label htmlFor="import-file">选择文件（上限 60 MB）</label>
            <input
              id="import-file"
              type="file"
              accept=".json,application/json"
              onChange={(e) => void handleFileChange(e)}
            />
            {fileName && <span class="muted">已选文件：{fileName}</span>}
          </div>

          <div class="field">
            <label htmlFor="import-format">导入格式</label>
            <select
              id="import-format"
              class="select"
              value={format}
              onChange={(e) =>
                setFormat((e.target as HTMLSelectElement).value as "auto" | "v1" | "lcx")
              }
            >
              <option value="auto">自动识别（v1 / 离愁轩）</option>
              <option value="v1">Better Endfield Gacha v1</option>
              <option value="lcx">离愁轩 JSON</option>
            </select>
          </div>

          <div class="field">
            <label htmlFor="import-target-account">目标账号（离愁轩格式必填）</label>
            <select
              id="import-target-account"
              class="select"
              value={targetAccount}
              onChange={(e) => setTargetAccount((e.target as HTMLSelectElement).value)}
            >
              <option value="">不指定（仅 v1 格式）</option>
              {accounts.map((acc) => (
                <option key={acc.accountKey} value={acc.accountKey}>
                  {acc.channelName} · {privacy ? acc.maskedKey : acc.accountKey.slice(-6)}
                </option>
              ))}
            </select>
          </div>

          {needsAccountForLcx && (
            <div class="warn-text">离愁轩格式导入必须先选择目标账号。</div>
          )}

          <div class="row-inline">
            <button
              type="button"
              class="btn"
              disabled={busy || !fileText || needsAccountForLcx}
              onClick={() => void runImport(false)}
            >
              预览导入（干跑）
            </button>
            <button
              type="button"
              class="btn primary"
              disabled={busy || !preview || preview.applied || needsAccountForLcx}
              onClick={() => void runImport(true)}
            >
              确认导入
            </button>
          </div>
        </section>

        {error && <div class="warn-text">{error}</div>}

        {preview && (
          <div class="info-box" aria-label="导入预览结果">
            <div>{preview.applied ? "导入已完成：" : "干跑预览："}</div>
            <ul class="list-plain">
              {preview.plans.map((p) => (
                <li key={p.maskedKey}>
                  {p.maskedKey}：总计 {p.total} · 新增 {p.added} · 重复 {p.duplicates} · 冲突{" "}
                  {p.conflicts} · 跳过 {p.skipped}
                </li>
              ))}
            </ul>
            {preview.warnings.map((w, i) => (
              <div key={i} class="warn-text">
                {w}
              </div>
            ))}
            {preview.unresolvedPools.length > 0 && (
              <div class="warn-text">
                未识别卡池：{preview.unresolvedPools.join("、")}
              </div>
            )}
            {preview.backup && <div>已自动备份：{preview.backup}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
