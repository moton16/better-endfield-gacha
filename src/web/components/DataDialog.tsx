import { useEffect, useState } from "preact/hooks";
import { api } from "../api/client.js";
import type {
  AccountSummary,
  BackupListResponse,
  BackupResponse,
  ExportSaveResponse,
  ImportResponse,
} from "../api/types.js";

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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function PlanResult({ res, doneText, dryText }: { res: ImportResponse; doneText: string; dryText: string }) {
  return (
    <div class="info-box" aria-label="预览结果">
      <div>{res.applied ? doneText : dryText}</div>
      <ul class="list-plain">
        {res.plans.map((p) => (
          <li key={p.maskedKey}>
            {p.maskedKey}：总计 {p.total} · 新增 {p.added} · 重复 {p.duplicates} · 冲突 {p.conflicts} · 跳过{" "}
            {p.skipped}
          </li>
        ))}
      </ul>
      {res.warnings.map((w, i) => (
        <div key={i} class="warn-text">
          {w}
        </div>
      ))}
      {res.unresolvedPools.length > 0 && (
        <div class="warn-text">未识别卡池：{res.unresolvedPools.join("、")}</div>
      )}
      {res.backup && <div>操作前已自动备份：{res.backup}</div>}
    </div>
  );
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
  const [lastExport, setLastExport] = useState<ExportSaveResponse | null>(null);

  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [format, setFormat] = useState<"auto" | "v1" | "lcx">("auto");
  // 空串 = 自动：v1 导入文件内全部账号；离愁轩按文件 UID 匹配已有账号，找不到则新建
  const [targetAccount, setTargetAccount] = useState("");
  const [detectedLcx, setDetectedLcx] = useState(false);
  const [preview, setPreview] = useState<ImportResponse | null>(null);

  const [backups, setBackups] = useState<BackupListResponse | null>(null);
  const [restoreFile, setRestoreFile] = useState("");
  const [restorePreview, setRestorePreview] = useState<ImportResponse | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLcx = format === "lcx" || (format === "auto" && detectedLcx);

  function fail(err: unknown) {
    if (onAuthError(err)) return;
    setError(err instanceof Error ? err.message : String(err));
  }

  async function loadBackups() {
    try {
      setBackups(await api<BackupListResponse>("/api/backups"));
    } catch (err) {
      fail(err);
    }
  }

  useEffect(() => {
    void loadBackups();
  }, []);

  async function openFolder(target: "exports" | "backups") {
    setError(null);
    try {
      await api("/api/open-folder", { method: "POST", body: { target } });
    } catch (err) {
      fail(err);
    }
  }

  async function handleExport(fmt: "json" | "csv") {
    setError(null);
    setBusy(true);
    try {
      const res = await api<ExportSaveResponse>("/api/export/save", {
        method: "POST",
        body: {
          format: fmt,
          ...(exportScope !== "all" ? { account: exportScope } : {}),
          includeGifts,
        },
      });
      setLastExport(res);
      onToast(`已导出 ${fmt.toUpperCase()}：${res.file}`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
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
    setBusy(true);
    setError(null);
    try {
      const res = await api<ImportResponse>("/api/import", {
        method: "POST",
        body: {
          text: fileText,
          format,
          ...(targetAccount ? { account: targetAccount } : isLcx ? { createAccount: true } : {}),
          apply,
        },
      });
      setPreview(res);
      if (apply) {
        const added = res.plans.reduce((s, p) => s + p.added, 0);
        await onDataChanged();
        void loadBackups();
        onToast(`导入完成，新增 ${added} 条${res.backup ? `（已备份：${res.backup}）` : ""}`);
      }
    } catch (err) {
      fail(err);
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
      await loadBackups();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function runRestore(file: string, apply: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<ImportResponse>("/api/backup/restore", { method: "POST", body: { file, apply } });
      setRestoreFile(file);
      setRestorePreview(res);
      if (apply) {
        const added = res.plans.reduce((s, p) => s + p.added, 0);
        await onDataChanged();
        await loadBackups();
        onToast(`恢复完成，补回 ${added} 条`);
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const accountOptions = accounts.map((acc) => (
    <option key={acc.accountKey} value={acc.accountKey}>
      {acc.channelName} · {privacy ? acc.maskedKey : acc.accountKey.slice(-6)}
    </option>
  ));

  return (
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="data-dialog-title">
        <div class="modal-head">
          <h2 id="data-dialog-title">导入 / 导出 / 备份</h2>
          <button type="button" class="btn" onClick={onClose} aria-label="关闭数据弹窗">
            关闭
          </button>
        </div>

        {error && <div class="warn-text">{error}</div>}

        <section class="info-box">
          <strong>导出记录</strong>
          <div class="muted" style={{ margin: "4px 0 6px" }}>
            点击后文件会直接保存到数据目录的 exports 文件夹，并在下方显示位置。
          </div>
          <div class="field">
            <label htmlFor="export-scope">导出范围</label>
            <select
              id="export-scope"
              class="select"
              value={exportScope}
              onChange={(e) => setExportScope((e.target as HTMLSelectElement).value)}
            >
              <option value="all">全部账号</option>
              {accountOptions}
            </select>
          </div>
          <label class="row-inline" style={{ marginBottom: "8px" }}>
            <input
              type="checkbox"
              checked={includeGifts}
              onChange={(e) => setIncludeGifts((e.target as HTMLInputElement).checked)}
            />
            <span>包含非抽卡赠品（如寻访情报书，仅 CSV 默认不含）</span>
          </label>
          <div class="row-inline">
            <button type="button" class="btn" disabled={busy} onClick={() => void handleExport("json")}>
              导出 JSON
            </button>
            <button type="button" class="btn" disabled={busy} onClick={() => void handleExport("csv")}>
              导出 CSV
            </button>
          </div>
          <div class="muted" style={{ marginTop: "6px" }}>
            JSON 可再次导入本工具（换电脑/迁移用）；CSV 仅供 Excel 查看，不能导回。
          </div>
          {lastExport && (
            <div style={{ marginTop: "8px" }}>
              <div>
                已保存：{lastExport.file}（{lastExport.accounts} 个账号 · {lastExport.records} 条 ·{" "}
                {fmtBytes(lastExport.bytes)}）
              </div>
              <div class="muted">位置：{lastExport.dir}</div>
            </div>
          )}
          <div class="row-inline" style={{ marginTop: "8px" }}>
            <button type="button" class="btn" onClick={() => void openFolder("exports")}>
              打开导出文件夹
            </button>
          </div>
        </section>

        <section class="info-box">
          <strong>导入 JSON（先预览，再确认写入）</strong>
          <div class="muted" style={{ margin: "4px 0 6px" }}>
            支持本工具导出的 JSON 与离愁轩 JSON。空库也能直接导入离愁轩文件，会自动按文件内 UID 建账号。
          </div>
          <div class="field">
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
              onChange={(e) => setFormat((e.target as HTMLSelectElement).value as "auto" | "v1" | "lcx")}
            >
              <option value="auto">自动识别（v1 / 离愁轩）</option>
              <option value="v1">Better Endfield Gacha v1</option>
              <option value="lcx">离愁轩 JSON</option>
            </select>
          </div>

          <div class="field">
            <label htmlFor="import-target-account">导入到哪个账号</label>
            <select
              id="import-target-account"
              class="select"
              value={targetAccount}
              onChange={(e) => setTargetAccount((e.target as HTMLSelectElement).value)}
            >
              <option value="">自动（v1：按文件内账号；离愁轩：匹配已有账号，没有则新建）</option>
              {accountOptions}
            </select>
          </div>

          <div class="row-inline">
            <button
              type="button"
              class="btn"
              disabled={busy || !fileText}
              onClick={() => void runImport(false)}
            >
              预览导入（干跑）
            </button>
            <button
              type="button"
              class="btn primary"
              disabled={busy || !preview || preview.applied}
              onClick={() => void runImport(true)}
            >
              确认导入
            </button>
          </div>
        </section>

        {preview && <PlanResult res={preview} doneText="导入已完成：" dryText="干跑预览：" />}

        <section class="info-box">
          <strong>备份与恢复</strong>
          <div class="muted" style={{ margin: "4px 0 6px" }}>
            备份是整个数据库的快照（.sqlite），保存在数据目录的 backups 文件夹；导入和恢复前也会自动备份。
            恢复是「合并」：把备份里本地缺少的记录补回来，不会删除或覆盖现有记录。
          </div>
          <div class="row-inline">
            <button type="button" class="btn" disabled={busy} onClick={() => void handleBackup()}>
              立即备份数据库
            </button>
            <button type="button" class="btn" onClick={() => void openFolder("backups")}>
              打开备份文件夹
            </button>
          </div>
          {backups && <div class="muted" style={{ marginTop: "6px" }}>位置：{backups.dir}</div>}
          {backups && backups.files.length === 0 && (
            <div class="muted" style={{ marginTop: "6px" }}>
              暂无备份。可把别处的 gacha-*.sqlite 备份文件放进备份文件夹后刷新。
            </div>
          )}
          {backups && backups.files.length > 0 && (
            <ul class="list-plain">
              {backups.files.map((f) => (
                <li key={f.file}>
                  <div>{f.file}</div>
                  <div class="muted">
                    {new Date(f.mtime).toLocaleString()} · {fmtBytes(f.size)}
                  </div>
                  <div class="row-inline" style={{ marginTop: "4px" }}>
                    <button type="button" class="btn" disabled={busy} onClick={() => void runRestore(f.file, false)}>
                      预览恢复
                    </button>
                    {restoreFile === f.file && restorePreview && !restorePreview.applied && (
                      <button
                        type="button"
                        class="btn primary"
                        disabled={busy}
                        onClick={() => void runRestore(f.file, true)}
                      >
                        确认恢复
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {restorePreview && (
          <PlanResult res={restorePreview} doneText="恢复已完成：" dryText="恢复预览（未写入）：" />
        )}
      </div>
    </div>
  );
}
