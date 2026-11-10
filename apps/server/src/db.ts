import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Repo, RunEvent, RunEventPayload, Task, TaskStatus } from "@forgeboard/shared";
import { config } from "./config.js";

mkdirSync(config.dataDir, { recursive: true });

const db = new DatabaseSync(join(config.dataDir, "forgeboard.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    title TEXT NOT NULL,
    provider TEXT NOT NULL,
    permission_mode TEXT NOT NULL,
    status TEXT NOT NULL,
    cost_usd REAL,
    duration_ms INTEGER,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    ts TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (task_id, seq)
  );
`);

type Row = Record<string, unknown>;

function toRepo(r: Row): Repo {
  return {
    id: String(r.id),
    name: String(r.name),
    path: String(r.path),
    createdAt: String(r.created_at),
  };
}

function toTask(r: Row): Task {
  return {
    id: String(r.id),
    repoId: String(r.repo_id),
    prompt: String(r.prompt),
    title: String(r.title),
    provider: r.provider as Task["provider"],
    permissionMode: r.permission_mode as Task["permissionMode"],
    status: r.status as TaskStatus,
    costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
    durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
    createdAt: String(r.created_at),
    finishedAt: r.finished_at == null ? null : String(r.finished_at),
  };
}

export const repos = {
  list(): Repo[] {
    return db.prepare("SELECT * FROM repos ORDER BY created_at DESC").all().map(toRepo);
  },
  get(id: string): Repo | undefined {
    const r = db.prepare("SELECT * FROM repos WHERE id = ?").get(id);
    return r ? toRepo(r) : undefined;
  },
  findByPath(path: string): Repo | undefined {
    const r = db.prepare("SELECT * FROM repos WHERE path = ?").get(path);
    return r ? toRepo(r) : undefined;
  },
  insert(repo: Repo): void {
    db.prepare("INSERT INTO repos (id, name, path, created_at) VALUES (?, ?, ?, ?)").run(
      repo.id,
      repo.name,
      repo.path,
      repo.createdAt,
    );
  },
  remove(id: string): void {
    db.prepare("DELETE FROM repos WHERE id = ?").run(id);
  },
};

export const tasks = {
  list(repoId?: string): Task[] {
    const rows = repoId
      ? db.prepare("SELECT * FROM tasks WHERE repo_id = ? ORDER BY created_at DESC").all(repoId)
      : db.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all();
    return rows.map(toTask);
  },
  get(id: string): Task | undefined {
    const r = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return r ? toTask(r) : undefined;
  },
  insert(task: Task): void {
    db.prepare(
      `INSERT INTO tasks (id, repo_id, prompt, title, provider, permission_mode, status, cost_usd, duration_ms, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      task.id,
      task.repoId,
      task.prompt,
      task.title,
      task.provider,
      task.permissionMode,
      task.status,
      task.costUsd,
      task.durationMs,
      task.createdAt,
      task.finishedAt,
    );
  },
  setStatus(id: string, status: TaskStatus): void {
    db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
  },
  finish(id: string, status: TaskStatus, costUsd: number | null, durationMs: number | null): void {
    db.prepare(
      "UPDATE tasks SET status = ?, cost_usd = ?, duration_ms = ?, finished_at = ? WHERE id = ?",
    ).run(status, costUsd, durationMs, new Date().toISOString(), id);
  },
  /** Tasks left "running" by a previous server process can never finish. */
  failInterrupted(): number {
    const res = db
      .prepare("UPDATE tasks SET status = 'error', finished_at = ? WHERE status IN ('running', 'queued')")
      .run(new Date().toISOString());
    return Number(res.changes);
  },
};

export const events = {
  list(taskId: string, afterSeq = 0): RunEvent[] {
    return db
      .prepare("SELECT * FROM events WHERE task_id = ? AND seq > ? ORDER BY seq")
      .all(taskId, afterSeq)
      .map((r) => ({
        ...(JSON.parse(String(r.payload)) as RunEventPayload),
        taskId: String(r.task_id),
        seq: Number(r.seq),
        ts: String(r.ts),
      }));
  },
  lastSeq(taskId: string): number {
    const r = db.prepare("SELECT MAX(seq) AS seq FROM events WHERE task_id = ?").get(taskId);
    return r?.seq == null ? 0 : Number(r.seq);
  },
  insert(event: RunEvent): void {
    const { taskId, seq, ts, ...payload } = event;
    db.prepare("INSERT INTO events (task_id, seq, ts, payload) VALUES (?, ?, ?, ?)").run(
      taskId,
      seq,
      ts,
      JSON.stringify(payload),
    );
  },
};
