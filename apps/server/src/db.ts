import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { nanoid } from "nanoid";
import { BUILD_AND_REVIEW, LEAD_DECIDES } from "@forgeboard/shared";
import type {
  Agent,
  AgentId,
  Flow,
  Team,
  HouseRule,
  Repo,
  RuleScope,
  RunEvent,
  RunEventPayload,
  Task,
  Workspace,
} from "@forgeboard/shared";
import { config } from "./config.js";

mkdirSync(config.dataDir, { recursive: true });

// v1 changed the schema completely, so it uses a new file instead of migrating v0 data.
const db = new DatabaseSync(join(config.dataDir, "forgeboard-v1.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

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

  -- The default crew.
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );

  -- Crew overrides for workspaces with their own crew.
  CREATE TABLE IF NOT EXISTS workspace_agents (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (workspace_id, agent_id)
  );

  -- Rules at three levels: global, workspace or repo (scope lives in data).
  CREATE TABLE IF NOT EXISTS house_rules (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Private per-task state the UI never needs (worktree path, agent session ids…).
  CREATE TABLE IF NOT EXISTS task_state (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    data TEXT NOT NULL
  );
`);

// ---------- Migrations ----------
// Each runs once, in order; PRAGMA user_version records how many have run.
// Databases from before v2.0 are at 0: migration 1 is the old ad hoc one and is safe to re-run.

const MIGRATIONS: (() => void)[] = [
  // 1 (v1.1): repos belong to workspaces; v1.0 kept rules per repo in a `rules` table.
  () => {
    const repoColumns = db.prepare("PRAGMA table_info(repos)").all().map((c) => String(c.name));
    if (!repoColumns.includes("workspace_id")) {
      db.exec("ALTER TABLE repos ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE");
    }
    const legacyRules = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rules'").get();
    if (legacyRules) {
      for (const r of db.prepare("SELECT data, repo_id, created_at FROM rules").all()) {
        const old = JSON.parse(String(r.data)) as Omit<HouseRule, "scope" | "workspaceId">;
        const rule: HouseRule = { ...old, scope: "repo", workspaceId: null, repoId: String(r.repo_id) };
        db.prepare("INSERT OR IGNORE INTO house_rules (id, data, created_at) VALUES (?, ?, ?)").run(rule.id, JSON.stringify(rule), String(r.created_at));
      }
      db.exec("DROP TABLE rules");
    }
  },
  // 2 (v2.0): flows you make. Built-in flows live in code.
  () => {
    db.exec(`CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  },
  // 3 (v2.3): teams you make (templates live in code). Members are stored inside the team.
  () => {
    db.exec(`CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  },
];

const schemaVersion = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
for (let v = schemaVersion; v < MIGRATIONS.length; v++) {
  db.exec("BEGIN");
  try {
    MIGRATIONS[v]!();
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

type Row = Record<string, unknown>;

function toRepo(r: Row): Repo {
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id ?? ""),
    name: String(r.name),
    path: String(r.path),
    checks: JSON.parse(String(r.checks)),
    createdAt: String(r.created_at),
  };
}

// ---------- Workspaces ----------

export const workspaces = {
  list(): Workspace[] {
    return db
      .prepare("SELECT data FROM workspaces ORDER BY created_at")
      .all()
      .map((r) => JSON.parse(String(r.data)) as Workspace);
  },
  get(id: string): Workspace | undefined {
    const r = db.prepare("SELECT data FROM workspaces WHERE id = ?").get(id);
    return r ? (JSON.parse(String(r.data)) as Workspace) : undefined;
  },
  save(ws: Workspace): void {
    db.prepare(
      "INSERT INTO workspaces (id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    ).run(ws.id, JSON.stringify(ws), ws.createdAt);
  },
  remove(id: string): void {
    for (const rule of rules.all()) {
      const repo = rule.repoId ? repos.get(rule.repoId) : undefined;
      if (rule.workspaceId === id || repo?.workspaceId === id) rules.remove(rule.id);
    }
    db.prepare("DELETE FROM repos WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  },
};

// Repos added before workspaces existed move into a "Personal" workspace.
const orphanRepos = db.prepare("SELECT COUNT(*) AS n FROM repos WHERE workspace_id IS NULL").get();
if (Number(orphanRepos?.n) > 0) {
  const ws: Workspace = {
    id: nanoid(10),
    name: "Personal",
    description: "",
    color: "violet",
    crewMode: "default",
    archived: false,
    createdAt: new Date().toISOString(),
  };
  workspaces.save(ws);
  db.prepare("UPDATE repos SET workspace_id = ? WHERE workspace_id IS NULL").run(ws.id);
}

// ---------- Repos ----------

export const repos = {
  list(workspaceId?: string): Repo[] {
    const rows = workspaceId
      ? db.prepare("SELECT * FROM repos WHERE workspace_id = ? ORDER BY created_at").all(workspaceId)
      : db.prepare("SELECT * FROM repos ORDER BY created_at").all();
    return rows.map(toRepo);
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
    db.prepare("INSERT INTO repos (id, workspace_id, name, path, checks, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      repo.id,
      repo.workspaceId,
      repo.name,
      repo.path,
      JSON.stringify(repo.checks),
      repo.createdAt,
    );
  },
  setChecks(id: string, checks: Repo["checks"]): void {
    db.prepare("UPDATE repos SET checks = ? WHERE id = ?").run(JSON.stringify(checks), id);
  },
  /** Moves a repo (and its tasks) to another workspace. */
  move(id: string, workspaceId: string): void {
    db.prepare("UPDATE repos SET workspace_id = ? WHERE id = ?").run(workspaceId, id);
    for (const task of tasks.list().filter((t) => t.repoId === id)) tasks.update(task.id, { workspaceId });
  },
  remove(id: string): void {
    for (const rule of rules.all().filter((r) => r.repoId === id)) rules.remove(rule.id);
    db.prepare("DELETE FROM repos WHERE id = ?").run(id);
  },
};

// ---------- Tasks ----------

function readTask(r: Row): Task {
  const task = JSON.parse(String(r.data)) as Task;
  // Tasks from v1.0 have no workspace; it follows from the repo.
  if (!task.workspaceId) task.workspaceId = repos.get(task.repoId)?.workspaceId ?? "";
  return task;
}

export const tasks = {
  list(filter: { workspaceId?: string; repoId?: string } = {}): Task[] {
    const rows = filter.repoId
      ? db.prepare("SELECT data FROM tasks WHERE repo_id = ? ORDER BY created_at DESC").all(filter.repoId)
      : db.prepare("SELECT data FROM tasks ORDER BY created_at DESC").all();
    const list = rows.map(readTask);
    return filter.workspaceId ? list.filter((t) => t.workspaceId === filter.workspaceId) : list;
  },
  get(id: string): Task | undefined {
    const r = db.prepare("SELECT data FROM tasks WHERE id = ?").get(id);
    return r ? readTask(r) : undefined;
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
  /** Before v2.0: the session of Forge's last step. Read as the session of the "forge" step. */
  forgeSession?: string;
  /** Session of each builder step's last run, by step id, so it resumes after a question or across rounds. */
  sessions?: Record<string, string>;
  /** The step a paused task continues from (after a question). */
  resumeStep?: string;
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

// ---------- Crew ----------

const DEFAULT_AGENTS: Agent[] = [
  {
    id: "forge",
    name: "Forge",
    role: "builder",
    provider: "claude-code",
    personality: "balanced",
    instructions: "Keep changes small and focused. Follow the conventions already used in the repository.",
  },
  {
    id: "hawk",
    name: "Hawk",
    role: "reviewer",
    provider: "claude-code",
    personality: "strict",
    instructions: "Block on failing checks and on real bugs. Do not nitpick style that a linter would catch.",
  },
  {
    id: "lead",
    name: "Lead",
    role: "lead",
    provider: "claude-code",
    personality: "balanced",
    instructions: "Pick the smallest team that does the task well. Skip the review for trivial changes; add one for anything risky or public.",
  },
];

function isBuiltIn(id: AgentId): boolean {
  return DEFAULT_AGENTS.some((d) => d.id === id);
}

function sameAgent(a: Agent, b: Agent): boolean {
  return a.name === b.name && a.provider === b.provider && a.personality === b.personality && a.instructions === b.instructions;
}

export const agents = {
  /** The default crew. */
  defaults(): Agent[] {
    const stored = new Map(
      db
        .prepare("SELECT data FROM agents")
        .all()
        .map((r) => {
          const a = JSON.parse(String(r.data)) as Agent;
          return [a.id, a] as const;
        }),
    );
    // A built-in agent's role is fixed (saved settings from before v2.0 have none).
    const builtIn = DEFAULT_AGENTS.map((d) => {
      const a = stored.get(d.id);
      return { ...(a ?? d), role: d.role, builtIn: true };
    });
    const mine = [...stored.values()].filter((a) => !isBuiltIn(a.id)).map((a) => ({ ...a, builtIn: false }));
    return [...builtIn, ...mine];
  },
  removeDefault(id: AgentId): void {
    db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  },
  saveDefault(agent: Agent): void {
    const { customized: _c, builtIn: _b, ...data } = agent;
    db.prepare("INSERT INTO agents (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(
      agent.id,
      JSON.stringify(data),
    );
  },
  /** A team's members. Forge, Hawk and Lead keep their role; in a team any member can be removed. */
  forTeam(teamId: string): Agent[] | undefined {
    const team = teams.get(teamId);
    if (!team) return undefined;
    return team.members.map((m) => {
      const builtIn = DEFAULT_AGENTS.find((d) => d.id === m.id);
      return { ...m, role: builtIn?.role ?? m.role, builtIn: false, customized: false };
    });
  },
  /** The crew a workspace actually uses. */
  forWorkspace(workspaceId: string | undefined): Agent[] {
    const defaults = agents.defaults();
    const ws = workspaceId ? workspaces.get(workspaceId) : undefined;
    if (ws?.crewMode === "team" && ws.teamId) return agents.forTeam(ws.teamId) ?? defaults;
    if (!ws || ws.crewMode !== "custom") return defaults;
    const overrides = new Map(
      db
        .prepare("SELECT agent_id, data FROM workspace_agents WHERE workspace_id = ?")
        .all(ws.id)
        .map((r) => [String(r.agent_id), JSON.parse(String(r.data)) as Agent] as const),
    );
    // A workspace with its own crew has a copy of every agent it uses, plus the ones it created itself.
    const crew = defaults
      .filter((d) => d.builtIn || overrides.has(d.id))
      .map((d) => {
        const o = overrides.get(d.id);
        return o ? { ...o, role: d.builtIn ? d.role : o.role, builtIn: d.builtIn, customized: !sameAgent(o, d) } : { ...d, customized: false };
      });
    const own = [...overrides.values()]
      .filter((o) => !defaults.some((d) => d.id === o.id))
      .map((o) => ({ ...o, builtIn: false, customized: false }));
    return [...crew, ...own];
  },
  /** An agent of a workspace's crew. Throws if it doesn't exist (a flow may name a deleted agent). */
  get(workspaceId: string | undefined, id: AgentId): Agent {
    const agent = agents.forWorkspace(workspaceId).find((a) => a.id === id);
    if (!agent) throw new Error(`The agent "${id}" isn't in this crew anymore.`);
    return agent;
  },
  /**
   * The agent a flow step runs in a workspace: its own crew's copy, or the default crew's when
   * the workspace's own crew doesn't have it (an agent created after the workspace got its own crew).
   */
  forFlow(workspaceId: string | undefined, id: AgentId): Agent | undefined {
    return agents.forWorkspace(workspaceId).find((a) => a.id === id) ?? agents.defaults().find((a) => a.id === id);
  },
  /** Like forFlow, but throws when neither crew has the agent (it was deleted). */
  forStep(workspaceId: string | undefined, id: AgentId): Agent {
    const agent = agents.forFlow(workspaceId, id);
    if (!agent) throw new Error(`The agent "${id}" isn't in this crew anymore.`);
    return agent;
  },
  removeForWorkspace(workspaceId: string, id: AgentId): void {
    db.prepare("DELETE FROM workspace_agents WHERE workspace_id = ? AND agent_id = ?").run(workspaceId, id);
  },
  saveForWorkspace(workspaceId: string, agent: Agent): void {
    const { customized: _c, builtIn: _b, ...data } = agent;
    db.prepare(
      "INSERT INTO workspace_agents (workspace_id, agent_id, data) VALUES (?, ?, ?) ON CONFLICT(workspace_id, agent_id) DO UPDATE SET data = excluded.data",
    ).run(workspaceId, agent.id, JSON.stringify(data));
  },
  resetForWorkspace(workspaceId: string, id: AgentId): void {
    db.prepare("DELETE FROM workspace_agents WHERE workspace_id = ? AND agent_id = ?").run(workspaceId, id);
  },
};

// ---------- Flows ----------

const BUILT_IN_FLOWS: Flow[] = [BUILD_AND_REVIEW, LEAD_DECIDES];

export const flows = {
  list(): Flow[] {
    const mine = db
      .prepare("SELECT data FROM flows ORDER BY created_at")
      .all()
      .map((r) => JSON.parse(String(r.data)) as Flow);
    return [...BUILT_IN_FLOWS, ...mine];
  },
  get(id: string): Flow | undefined {
    const builtIn = BUILT_IN_FLOWS.find((f) => f.id === id);
    if (builtIn) return builtIn;
    const r = db.prepare("SELECT data FROM flows WHERE id = ?").get(id);
    return r ? (JSON.parse(String(r.data)) as Flow) : undefined;
  },
  save(flow: Flow): void {
    const { builtIn: _b, ...data } = flow;
    db.prepare(
      "INSERT INTO flows (id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    ).run(flow.id, JSON.stringify(data), new Date().toISOString());
  },
  remove(id: string): void {
    db.prepare("DELETE FROM flows WHERE id = ?").run(id);
  },
  /** Flows you made that use an agent, so it isn't deleted from under them. */
  usingAgent(agentId: AgentId): Flow[] {
    return flows.list().filter((f) => !f.builtIn && f.steps.some((s) => s.type === "agent" && s.agentId === agentId));
  },
};

// ---------- Teams ----------

export const teams = {
  list(): Team[] {
    return db
      .prepare("SELECT data FROM teams ORDER BY created_at")
      .all()
      .map((r) => JSON.parse(String(r.data)) as Team);
  },
  get(id: string): Team | undefined {
    const r = db.prepare("SELECT data FROM teams WHERE id = ?").get(id);
    return r ? (JSON.parse(String(r.data)) as Team) : undefined;
  },
  save(team: Team): void {
    const members = team.members.map(({ customized: _c, builtIn: _b, ...m }) => m);
    db.prepare(
      "INSERT INTO teams (id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    ).run(team.id, JSON.stringify({ ...team, members }), team.createdAt);
  },
  remove(id: string): void {
    db.prepare("DELETE FROM teams WHERE id = ?").run(id);
  },
};

// ---------- House rules ----------

export const rules = {
  all(): HouseRule[] {
    return db
      .prepare("SELECT data FROM house_rules ORDER BY created_at DESC")
      .all()
      .map((r) => JSON.parse(String(r.data)) as HouseRule);
  },
  /** Rules defined at exactly one level. */
  list(scope: RuleScope, id?: string): HouseRule[] {
    return rules.all().filter(
      (r) =>
        r.scope === scope &&
        (scope === "global" || (scope === "workspace" ? r.workspaceId === id : r.repoId === id)),
    );
  },
  /** Every rule that applies to work in a repo: global, its workspace's and its own. */
  forRepo(repo: Repo): HouseRule[] {
    return rules
      .all()
      .filter((r) => r.scope === "global" || (r.scope === "workspace" && r.workspaceId === repo.workspaceId) || (r.scope === "repo" && r.repoId === repo.id));
  },
  get(id: string): HouseRule | undefined {
    const r = db.prepare("SELECT data FROM house_rules WHERE id = ?").get(id);
    return r ? (JSON.parse(String(r.data)) as HouseRule) : undefined;
  },
  save(rule: HouseRule): void {
    db.prepare(
      "INSERT INTO house_rules (id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    ).run(rule.id, JSON.stringify(rule), rule.createdAt);
  },
  remove(id: string): void {
    db.prepare("DELETE FROM house_rules WHERE id = ?").run(id);
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
