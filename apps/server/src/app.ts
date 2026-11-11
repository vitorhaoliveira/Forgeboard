import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  BUILD_AND_REVIEW_ID,
  isFinished,
  LOCALES,
  MAX_AGENTS,
  MAX_FLOW_ROUNDS,
  MAX_FLOW_STEPS,
  validateFlow,
  WORKSPACE_COLORS,
  type Agent,
  type Flow,
  type FlowProblem,
  type HouseRule,
  type Repo,
  type RuleScope,
  type RunEvent,
  type Task,
  type Workspace,
  type WorkspaceColor,
} from "@forgeboard/shared";
import { auth, matchesToken } from "./auth.js";
import { bus } from "./bus.js";
import { detectChecks } from "./checks.js";
import { config } from "./config.js";
import { agents, events, flows, repos, rules, tasks, workspaces } from "./db.js";
import { GitError, repoRoot } from "./git.js";
import {
  ackAssumptions,
  answerQuestion,
  discardTask,
  FlowError,
  mergeTask,
  sendBack,
  sendMessage,
  startTask,
  stopTask,
  taskDiff,
} from "./orchestrator.js";
import { listProviders } from "./providers/index.js";

export const app = new Hono();

app.use("/api/*", cors({ origin: config.webOrigins }));

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Only Forgeboard's own UI may drive the API: it can edit files and run commands on this machine.
 * - Host must be local, which blocks DNS rebinding.
 * - Changes need a JSON body, so a browser always sends a CORS preflight first (a plain
 *   cross-site form or text/plain POST is refused), and a foreign Origin is refused outright.
 * - With an access key on (the `forgeboard` command), every call needs it, as a cookie or a Bearer header.
 */
app.use("/api/*", async (c, next) => {
  const host = c.req.header("host") ?? "";
  if (!LOCAL_HOSTS.has(host.replace(/:\d+$/, ""))) return c.json({ error: "Forbidden host" }, 403);
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && origin !== `http://${host}` && !config.webOrigins.includes(origin)) return c.json({ error: "Forbidden origin" }, 403);
    if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) return c.json({ error: "Expected a JSON body" }, 415);
  }
  if (auth.token && c.req.path !== "/api/health") {
    const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!matchesToken(bearer) && !matchesToken(getCookie(c, auth.cookieName))) {
      return c.json({ error: "Open the link printed in the terminal where forgeboard is running.", code: "auth" }, 401);
    }
  }
  await next();
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  if (err instanceof FlowError || err instanceof GitError) return c.json({ error: err.message }, 409);
  console.error(err);
  return c.json({ error: err.message }, 500);
});

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  return parsed.data;
}

class HttpError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

function mustGetTask(id: string): Task {
  const task = tasks.get(id);
  if (!task) throw new HttpError(404, "Task not found");
  return task;
}

app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/providers", async (c) => c.json(await listProviders()));

// ---------- Workspaces ----------

const colorSchema = z.enum(WORKSPACE_COLORS as [WorkspaceColor, ...WorkspaceColor[]]);

function hasOpenTasks(filter: { workspaceId?: string; repoId?: string }): boolean {
  return tasks.list(filter).some((t) => !isFinished(t.status));
}

/** Validates a folder and registers it as a repo in a workspace. */
async function addRepoAt(raw: string, workspaceId: string): Promise<Repo> {
  const path = resolve(raw.trim().replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new HttpError(400, `Folder not found: ${path}`);
  const root = await repoRoot(path);
  if (!root) throw new HttpError(400, `${path} isn't a git repository. Run \`git init\` and make a first commit.`);

  const existing = repos.findByPath(root);
  if (existing) {
    if (existing.workspaceId === workspaceId) return existing;
    const other = workspaces.get(existing.workspaceId);
    throw new HttpError(400, `${existing.name} already belongs to the workspace "${other?.name ?? "?"}". Move it from that workspace's settings.`);
  }
  const repo: Repo = {
    id: nanoid(10),
    workspaceId,
    name: basename(root),
    path: root,
    checks: detectChecks(root),
    createdAt: new Date().toISOString(),
  };
  repos.insert(repo);
  return repo;
}

function mustGetWorkspace(id: string): Workspace {
  const ws = workspaces.get(id);
  if (!ws) throw new HttpError(404, "Workspace not found");
  return ws;
}

app.get("/api/workspaces", (c) => c.json(workspaces.list()));

app.post("/api/workspaces", async (c) => {
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(40),
      description: z.string().trim().max(80).default(""),
      color: colorSchema,
      crewFrom: z.string().nullable().optional(),
      repoPaths: z.array(z.string().min(1)).max(20).default([]),
    }),
  );
  const source = input.crewFrom ? mustGetWorkspace(input.crewFrom) : null;

  // Validate every folder before creating anything.
  for (const p of input.repoPaths) {
    const root = await repoRoot(resolve(p.trim().replace(/^~(?=$|\/)/, process.env.HOME ?? "~")));
    if (!root) throw new HttpError(400, `${p} isn't a git repository.`);
    if (repos.findByPath(root)) throw new HttpError(400, `${basename(root)} already belongs to another workspace.`);
  }

  const ws: Workspace = {
    id: nanoid(10),
    name: input.name,
    description: input.description,
    color: input.color,
    crewMode: source ? "custom" : "default",
    archived: false,
    createdAt: new Date().toISOString(),
  };
  workspaces.save(ws);
  if (source) for (const agent of agents.forWorkspace(source.id)) agents.saveForWorkspace(ws.id, agent);
  for (const p of input.repoPaths) await addRepoAt(p, ws.id);
  return c.json(ws, 201);
});

app.patch("/api/workspaces/:id", async (c) => {
  const ws = mustGetWorkspace(c.req.param("id"));
  const patch = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(40).optional(),
      description: z.string().trim().max(80).optional(),
      color: colorSchema.optional(),
      crewMode: z.enum(["default", "custom"]).optional(),
      forgeCommands: z.enum(["standard", "restricted"]).optional(),
      askMode: z.enum(["ask", "decide"]).optional(),
      planFirst: z.boolean().optional(),
      messageDelivery: z.enum(["now", "later"]).optional(),
      defaultFlowId: z.string().min(1).optional(),
      archived: z.boolean().optional(),
    }),
  );
  if (patch.defaultFlowId) flowFor(ws.id, patch.defaultFlowId);
  const next = { ...ws, ...patch };
  // Switching to a custom crew starts from the default crew.
  if (patch.crewMode === "custom" && ws.crewMode !== "custom") {
    for (const agent of agents.defaults()) agents.saveForWorkspace(ws.id, agent);
  }
  workspaces.save(next);
  return c.json(next);
});

app.delete("/api/workspaces/:id", (c) => {
  const ws = mustGetWorkspace(c.req.param("id"));
  if (hasOpenTasks({ workspaceId: ws.id })) {
    throw new FlowError("This workspace has open tasks. Merge, discard or wait for them first.");
  }
  workspaces.remove(ws.id);
  return c.body(null, 204);
});

// ---------- Repos ----------

app.get("/api/repos", (c) => c.json(repos.list(c.req.query("workspaceId"))));

app.post("/api/repos", async (c) => {
  const { path, workspaceId } = await body(c, z.object({ path: z.string().min(1), workspaceId: z.string().min(1) }));
  mustGetWorkspace(workspaceId);
  return c.json(await addRepoAt(path, workspaceId), 201);
});

const checkSchema = z.object({ name: z.string().trim().min(1).max(40), command: z.string().trim().min(1).max(500) });

app.patch("/api/repos/:id", async (c) => {
  const repo = repos.get(c.req.param("id"));
  if (!repo) throw new HttpError(404, "Repo not found");
  const { checks, workspaceId } = await body(
    c,
    z.object({ checks: z.array(checkSchema).max(10).optional(), workspaceId: z.string().optional() }),
  );
  if (checks) repos.setChecks(repo.id, checks);
  if (workspaceId && workspaceId !== repo.workspaceId) {
    mustGetWorkspace(workspaceId);
    if (hasOpenTasks({ repoId: repo.id })) throw new FlowError("This repository has open tasks. Finish them before moving it.");
    repos.move(repo.id, workspaceId);
  }
  return c.json(repos.get(repo.id));
});

app.delete("/api/repos/:id", (c) => {
  const id = c.req.param("id");
  if (hasOpenTasks({ repoId: id })) throw new FlowError("This repository has open tasks. Merge, discard or wait for them first.");
  repos.remove(id);
  return c.body(null, 204);
});

// ---------- Crew ----------

app.get("/api/agents", (c) => c.json(agents.forWorkspace(c.req.query("workspaceId"))));

const agentFields = {
  name: z.string().trim().min(1).max(24),
  provider: z.enum(["claude-code", "codex", "mock"]),
  personality: z.enum(["mentor", "balanced", "strict"]),
  instructions: z.string().max(2_000),
};

/** The crew an agent request works on: a workspace's own crew (switching it to "custom"), or the default crew. */
function crewOf(workspaceId: string | undefined): Agent[] {
  return agents.forWorkspace(workspaceId);
}

function mustGetAgent(workspaceId: string | undefined, id: string): Agent {
  const agent = crewOf(workspaceId).find((a) => a.id === id);
  if (!agent) throw new HttpError(404, "Agent not found");
  return agent;
}

/** Creates an agent with a role, in the default crew or in a workspace's own crew. */
app.post("/api/agents", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const input = await body(
    c,
    z.object({ ...agentFields, role: z.enum(["builder", "reviewer"]), instructions: agentFields.instructions.default("") }),
  );
  if (crewOf(workspaceId).length >= MAX_AGENTS) throw new FlowError(`A crew can have at most ${MAX_AGENTS} agents.`);
  const agent: Agent = { id: nanoid(8), ...input };
  if (workspaceId) {
    const ws = mustGetWorkspace(workspaceId);
    if (ws.crewMode !== "custom") {
      // Moving to its own crew starts from a copy of the default crew.
      for (const a of agents.defaults()) agents.saveForWorkspace(ws.id, a);
      workspaces.save({ ...ws, crewMode: "custom" });
    }
    agents.saveForWorkspace(ws.id, agent);
    return c.json(mustGetAgent(ws.id, agent.id), 201);
  }
  agents.saveDefault(agent);
  return c.json(mustGetAgent(undefined, agent.id), 201);
});

app.patch("/api/agents/:id", async (c) => {
  const id = c.req.param("id");
  const workspaceId = c.req.query("workspaceId");
  const current = mustGetAgent(workspaceId, id);
  const patch = await body(
    c,
    z.object({
      name: agentFields.name.optional(),
      provider: agentFields.provider.optional(),
      personality: agentFields.personality.optional(),
      instructions: agentFields.instructions.optional(),
      role: z.enum(["builder", "reviewer"]).optional(),
    }),
  );
  // A built-in agent's role is fixed.
  const next: Agent = { ...current, ...patch, role: current.builtIn ? current.role : (patch.role ?? current.role) };
  if (workspaceId) {
    const ws = mustGetWorkspace(workspaceId);
    if (ws.crewMode !== "custom") {
      for (const a of agents.defaults()) agents.saveForWorkspace(ws.id, a);
      workspaces.save({ ...ws, crewMode: "custom" });
    }
    agents.saveForWorkspace(ws.id, next);
    return c.json(mustGetAgent(ws.id, id));
  }
  agents.saveDefault(next);
  return c.json(mustGetAgent(undefined, id));
});

/**
 * Forge and Hawk: puts a workspace's copy back to the default crew's settings.
 * Agents you created: deletes them from that crew.
 */
app.delete("/api/agents/:id", (c) => {
  const id = c.req.param("id");
  const workspaceId = c.req.query("workspaceId");
  const agent = mustGetAgent(workspaceId, id);
  if (agent.builtIn) {
    if (!workspaceId) throw new HttpError(400, "Built-in agents can't be deleted.");
    const ws = mustGetWorkspace(workspaceId);
    agents.saveForWorkspace(ws.id, agents.defaults().find((a) => a.id === id)!);
    return c.json(agents.get(ws.id, id));
  }
  const usedBy = flows.usingAgent(id);
  if (usedBy.length) throw new FlowError(`${agent.name} is used by the flow "${usedBy[0]!.name}". Remove it from the flow first.`);
  if (workspaceId) agents.removeForWorkspace(mustGetWorkspace(workspaceId).id, id);
  else agents.removeDefault(id);
  return c.body(null, 204);
});

// ---------- Flows ----------

const flowStepSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal("agent"),
    agentId: z.string().min(1).max(40),
    sendBackTo: z.string().min(1).max(40).optional(),
    maxRounds: z.number().int().min(1).max(MAX_FLOW_ROUNDS).optional(),
  }),
  z.object({ id: z.string().min(1).max(40), type: z.literal("checks") }),
  z.object({ id: z.string().min(1).max(40), type: z.literal("ask"), note: z.string().max(300).optional() }),
]);

const flowSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200).default(""),
  steps: z.array(flowStepSchema).min(1).max(MAX_FLOW_STEPS),
});

function describeProblem(p: FlowProblem): string {
  switch (p.code) {
    case "name": return "The flow needs a name.";
    case "empty": return "The flow needs at least one step.";
    case "tooMany": return `A flow can have at most ${p.max} steps.`;
    case "duplicateId": return `Two steps share the id "${p.step}".`;
    case "firstNotBuilder": return "The first step must be an agent that builds.";
    case "unknownAgent": return `The step "${p.step}" uses an agent this crew doesn't have.`;
    case "sendBackNotBuilder": return `The step "${p.step}" must send work back to a builder before it.`;
    case "builderSendBack": return `The step "${p.step}" builds, so it can't send work back.`;
    case "rounds": return `Rounds must be between 1 and ${p.max}.`;
  }
}

/** Throws when a flow can't run with a crew (the default crew when no workspace is given). */
function checkFlow(flow: Pick<Flow, "name" | "steps">, workspaceId?: string): void {
  const problems = validateFlow(flow, (id) => agents.forFlow(workspaceId, id)?.role);
  if (problems.length) throw new HttpError(400, describeProblem(problems[0]!));
}

/** A flow a workspace can run: it must exist and fit that workspace's crew. */
function flowFor(workspaceId: string, flowId: string): Flow {
  const flow = flows.get(flowId);
  if (!flow) throw new HttpError(404, "Flow not found");
  checkFlow(flow, workspaceId);
  return flow;
}

app.get("/api/flows", (c) => c.json(flows.list()));

app.post("/api/flows", async (c) => {
  const input = await body(c, flowSchema);
  checkFlow(input);
  const flow: Flow = { id: nanoid(10), ...input };
  flows.save(flow);
  return c.json(flow, 201);
});

app.patch("/api/flows/:id", async (c) => {
  const current = flows.get(c.req.param("id"));
  if (!current) throw new HttpError(404, "Flow not found");
  if (current.builtIn) throw new HttpError(400, "Built-in flows can't be changed. Duplicate it instead.");
  const input = await body(c, flowSchema);
  checkFlow(input);
  const flow: Flow = { ...current, ...input };
  flows.save(flow);
  return c.json(flow);
});

app.delete("/api/flows/:id", (c) => {
  const flow = flows.get(c.req.param("id"));
  if (!flow) throw new HttpError(404, "Flow not found");
  if (flow.builtIn) throw new HttpError(400, "Built-in flows can't be deleted.");
  // Workspaces that used it go back to Build & Review; tasks keep their own copy.
  for (const ws of workspaces.list()) {
    if (ws.defaultFlowId === flow.id) workspaces.save({ ...ws, defaultFlowId: undefined });
  }
  flows.remove(flow.id);
  return c.body(null, 204);
});

// ---------- House rules ----------

const scopeSchema = z.enum(["global", "workspace", "repo"]);

app.get("/api/rules", (c) => {
  const scope = scopeSchema.safeParse(c.req.query("scope"));
  if (!scope.success) throw new HttpError(400, "scope must be global, workspace or repo");
  return c.json(rules.list(scope.data, c.req.query("id")));
});

function placeRule(scope: RuleScope, id?: string | null): Pick<HouseRule, "scope" | "workspaceId" | "repoId"> {
  if (scope === "global") return { scope, workspaceId: null, repoId: null };
  if (!id) throw new HttpError(400, "id is required for this scope");
  if (scope === "workspace") return { scope, workspaceId: mustGetWorkspace(id).id, repoId: null };
  if (!repos.get(id)) throw new HttpError(404, "Repo not found");
  return { scope, workspaceId: null, repoId: id };
}

app.post("/api/rules", async (c) => {
  const input = await body(
    c,
    z.object({
      scope: scopeSchema,
      id: z.string().nullable().optional(),
      text: z.string().trim().min(3).max(500),
      source: z.enum(["you", "answer", "hawk"]).default("you"),
    }),
  );
  const rule: HouseRule = {
    id: nanoid(10),
    ...placeRule(input.scope, input.id),
    text: input.text,
    source: input.source,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  rules.save(rule);
  return c.json(rule, 201);
});

app.patch("/api/rules/:id", async (c) => {
  const rule = rules.get(c.req.param("id"));
  if (!rule) throw new HttpError(404, "Rule not found");
  const patch = await body(
    c,
    z.object({
      enabled: z.boolean().optional(),
      text: z.string().trim().min(3).max(500).optional(),
      /** Move the rule to another level. */
      scope: scopeSchema.optional(),
      id: z.string().nullable().optional(),
    }),
  );
  const next: HouseRule = {
    ...rule,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.text ? { text: patch.text } : {}),
    ...(patch.scope ? placeRule(patch.scope, patch.id) : {}),
  };
  rules.save(next);
  return c.json(next);
});

app.delete("/api/rules/:id", (c) => {
  rules.remove(c.req.param("id"));
  return c.body(null, 204);
});

// ---------- Tasks ----------

app.get("/api/tasks", (c) => c.json(tasks.list({ workspaceId: c.req.query("workspaceId"), repoId: c.req.query("repoId") })));

function makeTitle(prompt: string): string {
  const firstLine = prompt.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

app.post("/api/tasks", async (c) => {
  const input = await body(
    c,
    z.object({
      repoId: z.string().min(1),
      prompt: z.string().trim().min(1).max(20_000),
      locale: z.enum(LOCALES as [string, ...string[]]),
      maxRounds: z.number().int().min(1).max(5).optional(),
      flowId: z.string().min(1).optional(),
    }),
  );
  const repo = repos.get(input.repoId);
  if (!repo) throw new HttpError(404, "Repo not found");
  // Copied now, so later edits to the flow don't change this task.
  const flow = flowFor(repo.workspaceId, input.flowId ?? workspaces.get(repo.workspaceId)?.defaultFlowId ?? BUILD_AND_REVIEW_ID);

  const now = new Date().toISOString();
  const task: Task = {
    id: nanoid(12),
    workspaceId: repo.workspaceId,
    repoId: input.repoId,
    prompt: input.prompt,
    title: makeTitle(input.prompt),
    locale: input.locale as Task["locale"],
    status: "queued",
    round: 0,
    maxRounds: input.maxRounds ?? 3,
    flow,
    branch: null,
    baseBranch: null,
    question: null,
    verdict: null,
    checks: null,
    summary: null,
    costUsd: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  };
  tasks.insert(task);
  startTask(task.id);
  return c.json(task, 201);
});

app.get("/api/tasks/:id", (c) => {
  const task = mustGetTask(c.req.param("id"));
  return c.json({ task, events: events.list(task.id) });
});

app.get("/api/tasks/:id/diff", async (c) => {
  const task = mustGetTask(c.req.param("id"));
  return c.json(await taskDiff(task.id));
});

app.post("/api/tasks/:id/answer", async (c) => {
  const task = mustGetTask(c.req.param("id"));
  const { text, remember, data, note, replan } = await body(
    c,
    z.object({
      text: z.string().trim().min(1).max(2_000),
      remember: z.boolean().default(false),
      // Answers to a form. The orchestrator checks them against the form the agent sent.
      data: z.record(z.string(), z.unknown()).optional(),
      note: z.string().trim().max(1_000).optional(),
      replan: z.boolean().optional(),
    }),
  );
  answerQuestion(task.id, text, remember, data, { note: note || undefined, replan });
  return c.json(tasks.get(task.id));
});

app.post("/api/tasks/:id/message", async (c) => {
  const task = mustGetTask(c.req.param("id"));
  const { text, delivery } = await body(
    c,
    z.object({ text: z.string().trim().min(1).max(5_000), delivery: z.enum(["now", "later"]).default("now") }),
  );
  sendMessage(task.id, text, delivery);
  return c.json(tasks.get(task.id));
});

app.post("/api/tasks/:id/assumptions/ack", (c) => {
  const task = mustGetTask(c.req.param("id"));
  return c.json(ackAssumptions(task.id));
});

app.post("/api/tasks/:id/send-back", async (c) => {
  const task = mustGetTask(c.req.param("id"));
  const { notes } = await body(c, z.object({ notes: z.string().trim().min(1).max(5_000) }));
  sendBack(task.id, notes);
  return c.json(tasks.get(task.id));
});

app.post("/api/tasks/:id/merge", async (c) => {
  const task = mustGetTask(c.req.param("id"));
  const { exclude } = await body(c, z.object({ exclude: z.array(z.string()).default([]) }));
  return c.json(await mergeTask(task.id, exclude));
});

app.post("/api/tasks/:id/discard", async (c) => {
  const task = mustGetTask(c.req.param("id"));
  return c.json(await discardTask(task.id));
});

app.post("/api/tasks/:id/stop", (c) => {
  const task = mustGetTask(c.req.param("id"));
  return stopTask(task.id) ? c.json({ ok: true }) : c.json({ error: "Task is not running" }, 409);
});

/**
 * Server-Sent Events: replays stored events after `Last-Event-ID` (or `?after=`),
 * then streams live ones. Sends `end` once the task is finished so the browser
 * closes the connection instead of reconnecting.
 */
app.get("/api/tasks/:id/stream", (c) => {
  const taskId = mustGetTask(c.req.param("id")).id;
  const after = Number(c.req.header("Last-Event-ID") ?? c.req.query("after") ?? 0) || 0;

  return streamSSE(c, async (stream) => {
    let lastSent = after;
    let closed = false;
    const queue: RunEvent[] = [];
    let wake: (() => void) | null = null;

    // Subscribe before reading history so nothing is lost in between.
    const unsubscribe = bus.subscribe(taskId, (event) => {
      queue.push(event);
      wake?.();
    });
    stream.onAbort(() => {
      closed = true;
      wake?.();
    });

    const send = async (event: RunEvent) => {
      if (event.seq <= lastSent) return;
      lastSent = event.seq;
      await stream.writeSSE({ event: "run", id: String(event.seq), data: JSON.stringify(event) });
    };
    const finished = () => isFinished(tasks.get(taskId)?.status ?? "error");

    try {
      for (const event of events.list(taskId, after)) await send(event);
      while (!closed && !(queue.length === 0 && finished())) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            wake = r;
            setTimeout(r, 15_000);
          });
          wake = null;
          if (queue.length === 0 && !closed) await stream.writeSSE({ event: "ping", data: "" });
        }
        while (queue.length > 0) await send(queue.shift()!);
      }
      if (!stream.aborted) await stream.writeSSE({ event: "end", data: "" });
    } finally {
      unsubscribe();
    }
  });
});
