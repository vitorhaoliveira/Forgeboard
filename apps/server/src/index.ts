import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { nanoid } from "nanoid";
import { z } from "zod";
import { isFinished, LOCALES, type RunEvent, type Task } from "@forgeboard/shared";
import { bus } from "./bus.js";
import { detectChecks } from "./checks.js";
import { config } from "./config.js";
import { agents, events, failInterruptedTasks, repos, rules, tasks } from "./db.js";
import { GitError, repoRoot } from "./git.js";
import {
  answerQuestion,
  discardTask,
  FlowError,
  mergeTask,
  sendBack,
  startTask,
  stopTask,
  taskDiff,
} from "./orchestrator.js";
import { listProviders } from "./providers/index.js";

const app = new Hono();

app.use("/api/*", cors({ origin: config.webOrigins }));

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

// ---------- Repos ----------

app.get("/api/repos", (c) => c.json(repos.list()));

app.post("/api/repos", async (c) => {
  const { path: raw } = await body(c, z.object({ path: z.string().min(1) }));
  const path = resolve(raw.trim().replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new HttpError(400, `Folder not found: ${path}`);

  const root = await repoRoot(path);
  if (!root) throw new HttpError(400, "This folder isn't a git repository. Run `git init` and make a first commit.");

  const existing = repos.findByPath(root);
  if (existing) return c.json(existing);

  const repo = { id: nanoid(10), name: basename(root), path: root, checks: detectChecks(root), createdAt: new Date().toISOString() };
  repos.insert(repo);
  return c.json(repo, 201);
});

const checkSchema = z.object({ name: z.string().trim().min(1).max(40), command: z.string().trim().min(1).max(500) });

app.patch("/api/repos/:id", async (c) => {
  const repo = repos.get(c.req.param("id"));
  if (!repo) throw new HttpError(404, "Repo not found");
  const { checks } = await body(c, z.object({ checks: z.array(checkSchema).max(10) }));
  repos.setChecks(repo.id, checks);
  return c.json(repos.get(repo.id));
});

app.delete("/api/repos/:id", (c) => {
  repos.remove(c.req.param("id"));
  return c.body(null, 204);
});

// ---------- Crew ----------

app.get("/api/agents", (c) => c.json(agents.list()));

app.patch("/api/agents/:id", async (c) => {
  const id = c.req.param("id");
  if (id !== "forge" && id !== "hawk") throw new HttpError(404, "Agent not found");
  const patch = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(24).optional(),
      provider: z.enum(["claude-code", "mock"]).optional(),
      personality: z.enum(["mentor", "balanced", "strict"]).optional(),
      instructions: z.string().max(2_000).optional(),
    }),
  );
  const agent = { ...agents.get(id), ...patch };
  agents.save(agent);
  return c.json(agent);
});

app.get("/api/rules", (c) => {
  const repoId = c.req.query("repoId");
  if (!repoId) throw new HttpError(400, "repoId is required");
  return c.json(rules.list(repoId));
});

app.post("/api/rules", async (c) => {
  const input = await body(
    c,
    z.object({
      repoId: z.string().min(1),
      text: z.string().trim().min(3).max(500),
      source: z.enum(["you", "answer", "hawk"]).default("you"),
    }),
  );
  if (!repos.get(input.repoId)) throw new HttpError(404, "Repo not found");
  const rule = { id: nanoid(10), ...input, enabled: true, createdAt: new Date().toISOString() };
  rules.save(rule);
  return c.json(rule, 201);
});

app.patch("/api/rules/:id", async (c) => {
  const rule = rules.get(c.req.param("id"));
  if (!rule) throw new HttpError(404, "Rule not found");
  const patch = await body(c, z.object({ enabled: z.boolean().optional(), text: z.string().trim().min(3).max(500).optional() }));
  const next = { ...rule, ...patch };
  rules.save(next);
  return c.json(next);
});

app.delete("/api/rules/:id", (c) => {
  rules.remove(c.req.param("id"));
  return c.body(null, 204);
});

// ---------- Tasks ----------

app.get("/api/tasks", (c) => c.json(tasks.list(c.req.query("repoId"))));

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
    }),
  );
  if (!repos.get(input.repoId)) throw new HttpError(404, "Repo not found");

  const now = new Date().toISOString();
  const task: Task = {
    id: nanoid(12),
    repoId: input.repoId,
    prompt: input.prompt,
    title: makeTitle(input.prompt),
    locale: input.locale as Task["locale"],
    status: "queued",
    round: 0,
    maxRounds: input.maxRounds ?? 3,
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
  const { text, remember } = await body(c, z.object({ text: z.string().trim().min(1).max(2_000), remember: z.boolean().default(false) }));
  answerQuestion(task.id, text, remember);
  return c.json(tasks.get(task.id));
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

const interrupted = failInterruptedTasks();
if (interrupted > 0) console.log(`Marked ${interrupted} interrupted task(s) as error.`);

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Forgeboard server on http://${config.host}:${info.port}`);
  console.log(`Data: ${config.dataDir}`);
});
