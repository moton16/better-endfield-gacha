import { randomUUID } from "node:crypto";
import { redact, scrubUrl } from "../core/redact.js";

export interface Job {
  id: string;
  kind: string;
  state: "running" | "done" | "error";
  progress: string[]; // 最近 50 条
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

/** 对日志与错误文本统一脱敏：擦除 URL token 参数，并将键值形式的长凭据替换为 redact 指纹。 */
export function sanitizeJobMessage(text: string): string {
  const scrubbed = scrubUrl(text);
  return scrubbed.replace(
    /((?:hy|oauth_?|u8_)?token["']?\s*[:=]\s*["']?)([^"'\s&,;<>}]+)/gi,
    (_m, prefix: string, val: string) => (val === "<redacted>" ? `${prefix}${val}` : `${prefix}${redact(val)}`),
  );
}

export class JobManager {
  private jobs = new Map<string, Job>();

  /** 同时只允许一个 running 的 sync 类任务 */
  hasRunning(kind?: string): boolean {
    return [...this.jobs.values()].some((j) => j.state === "running" && (!kind || j.kind === kind));
  }

  start(kind: string, fn: (log: (m: string) => void) => Promise<unknown>): Job {
    const job: Job = { id: randomUUID(), kind, state: "running", progress: [], startedAt: Date.now() };
    this.jobs.set(job.id, job);
    const log = (m: string) => {
      job.progress.push(sanitizeJobMessage(m));
      if (job.progress.length > 50) job.progress.shift();
    };
    fn(log).then(
      (r) => {
        job.state = "done";
        job.result = r;
        job.endedAt = Date.now();
        this.trim();
      },
      (e) => {
        job.state = "error";
        job.error = sanitizeJobMessage(e instanceof Error ? e.message : String(e));
        job.endedAt = Date.now();
        this.trim();
      },
    );
    this.trim();
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  private trim(): void {
    const done = [...this.jobs.values()]
      .filter((j) => j.state !== "running")
      .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
    while (done.length > 20) this.jobs.delete(done.shift()!.id);
  }
}
