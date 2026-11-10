import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Agent,
  AgentId,
  HouseRule,
  Repo,
  RunEvent,
  RunEventPayload,
  Task,
} from "@forgeboard/shared";
import { config } from "./config.js";

mkdirSync(config.dataDir, { recursive: true });

// v1 changed the schema completely, so it uses a new file instead of migrating v0 data.
const db = new DatabaseSync(join(config.dataDir, "forgeboard-v1.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    checks TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    ts TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (task_id, seq)
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Private per-task state the UI never needs (worktree path, agent session ids…).
  CREATE TABLE IF NOT EXISTS task_state (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    data TEXT NOT NULL
  );
`);

type Row = Record<string, unknown>;

function toRepo(r: Row): Repo {
  return {
    id: String(r.id),
    name: String(r.name),
    path: String(r.path),
    checks: JSON.parse(String(r.checks)),
    createdAt: String(r.created_at),
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
    db.prepare("INSERT INTO repos (id, name, path, checks, created_at) VALUES (?, ?, ?, ?, ?)").run(
      repo.id,
      repo.name,
      repo.path,
      JSON.stringify(repo.checks),
      repo.createdAt,
    );
  },
  setChecks(id: string, checks: Repo["checks"]): void {
    db.prepare("UPDATE repos SET checks = ? WHERE id = ?").run(JSON.stringify(checks), id);
  },
  remove(id: string): void {
    db.prepare("DELETE FROM repos WHERE id = ?").run(id);
  },
};

export const tasks = {
  list(repoId?: string): Task[] {
    const rows = repoId
      ? db.prepare("SELECT data FROM tasks WHERE repo_id = ? ORDER BY created_at DESC").all(repoId)
      : db.prepare("SELECT data FROM tasks ORDER BY created_at DESC").all();
    return rows.map((r) => JSON.parse(String(r.data)) as Task);
  },
  get(id: string): Task | undefined {
    const r = db.prepare("SELECT data FROM tasks WHERE id = ?").get(id);
    return r ? (JSON.parse(String(r.data)) as Task) : undefined;
  },
  insert(task: Task): void {
    db.prepare("INSERT INTO tasks (id, repo_id, data, created_at) VALUES (?, ?, ?, ?)").run(
      task.id,
      task.repoId,
      JSON.stringify(task),
      task.createdAt,
    );
  },
  /** Merges fields into the stored task and returns the result. */
  update(id: string, patch: Partial<Task>): Task {
    const current = tasks.get(id);
    if (!current) throw new Error(`Task ${id} not found`);
    const next: Task = { ...current, ...patch, updatedAt: new Date().toISOString() };
    db.prepare("UPDATE tasks SET data = ? WHERE id = ?").run(JSON.stringify(next), id);
    return next;
  },
};

export interface TaskState {
  worktreePath?: string;
  baseSha?: string;
  /** Claude Code session of Forge's last step, used to resume after a question. */
  forgeSession?: string;
}

export const taskState = {
  get(taskId: string): TaskState {
    const r = db.prepare("SELECT data FROM task_state WHERE task_id = ?").get(taskId);
    return r ? (JSON.parse(String(r.data)) as TaskState) : {};
  },
  set(taskId: string, patch: TaskState): TaskState {
    const next = { ...taskState.get(taskId), ...patch };
    db.prepare(
      "INSERT INTO task_state (task_id, data) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET data = excluded.data",
    ).run(taskId, JSON.stringify(next));
    return next;
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

const DEFAULT_AGENTS: Agent[] = [
  {
    id: "forge",
    name: "Forge",
    provider: "claude-code",
    personality: "balanced",
    instructions: "Keep changes small and focused. Follow the conventions already used in the repository.",
  },
  {
    id: "hawk",
    name: "Hawk",
    provider: "claude-code",
    personality: "strict",
    instructions: "Block on failing checks and on real bugs. Do not nitpick style that a linter would catch.",
  },
];

export const agents = {
  list(): Agent[] {
    const stored = new Map(
      db
        .prepare("SELECT data FROM agents")
        .all()
        .map((r) => {
          const a = JSON.parse(String(r.data)) as Agent;
          return [a.id, a] as const;
        }),
    );
    return DEFAULT_AGENTS.map((d) => stored.get(d.id) ?? d);
  },
  get(id: AgentId): Agent {
    return agents.list().find((a) => a.id === id)!;
  },
  save(agent: Agent): void {
    db.prepare(
      "INSERT INTO agents (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    ).run(agent.id, JSON.stringify(agent));
  },
};

export const rules = {
  list(repoId: string): HouseRule[] {
    return db
      .prepare("SELECT data FROM rules WHERE repo_id = ? ORDER BY created_at DESC")
      .all(repoId)
      .map((r) => JSON.parse(String(r.data)) as HouseRule);
  },
  get(id: string): HouseRule | undefined {
    const r = db.prepare("SELECT data FROM rules WHERE id = ?").get(id);
    return r ? (JSON.parse(String(r.data)) as HouseRule) : undefined;
  },
  save(rule: HouseRule): void {
    db.prepare(
      "INSERT INTO rules (id, repo_id, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    ).run(rule.id, rule.repoId, JSON.stringify(rule), rule.createdAt);
  },
  remove(id: string): void {
    db.prepare("DELETE FROM rules WHERE id = ?").run(id);
  },
};

/** Tasks left running by a previous server process can never finish. */
export function failInterruptedTasks(): number {
  let count = 0;
  for (const task of tasks.list()) {
    if (task.status === "running" || task.status === "queued") {
      tasks.update(task.id, {
        status: "error",
        error: "The server stopped while this task was running.",
        finishedAt: new Date().toISOString(),
      });
      count++;
    }
  }
  return count;
}
