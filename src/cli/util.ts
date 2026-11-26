import type { SyncReport } from "../core/sync/sync.js";

export { maskKey } from "../core/mask.js";

export function maskName(name: string, show: boolean): string {
  return show ? name || "?" : "***";
}

export function fmtTime(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString() : "-";
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function printReport(report: SyncReport, extraWarnings: string[] = []): void {
  for (const f of report.feeds) {
    const tag = f.status === "ok" ? "✓" : f.status === "skipped" ? "–" : "✗";
    console.log(`  ${tag} ${f.label.padEnd(10)} 拉取 ${f.fetched} 条，新增 ${f.added}${f.error ? `  (${f.error})` : ""}`);
  }
  for (const w of [...extraWarnings, ...report.warnings]) console.log(`  ! ${w}`);
  console.log(`共新增 ${report.totalAdded} 条。`);
}
