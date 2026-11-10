import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { nanoid } from "nanoid";
import { z } from "zod";
import { isTerminalStatus, type RunEvent, type Task } from "@forgeboard/shared";
import { bus } from "./bus.js";
import { config } from "./config.js";
import { events, repos, tasks } from "./db.js";
import { listProviders } from "./providers/index.js";
import { cancelTask, startTask } from "./runner.js";

const app = new Hono();

app.use("/api/*", cors({ origin: config.webOrigins }));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/providers", async (c) => c.json(await listProviders()));

// ---------- Repos ----------

app.get("/api/repos", (c) => c.json(repos.list()));

const createRepoSchema = z.object({ path: z.string().min(1) });

app.post("/api/repos", async (c) => {
  const parsed = createRepoSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Send { path }" }, 400);

  const path = resolve(parsed.data.path.trim().replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return c.json({ error: `Folder not found: ${path}` }, 400);
  }

  const existing = repos.findByPath(path);
  if (existing) return c.json(existing);

  const repo = { id: nanoid(10), name: basename(path), path, createdAt: new Date().toISOString() };
  repos.insert(repo);
  return c.json(repo, 201);
});

app.delete("/api/repos/:id", (c) => {
  repos.remove(c.req.param("id"));
  return c.body(null, 204);
});

// ---------- Tasks ----------

app.get("/api/tasks", (c) => c.json(tasks.list(c.req.query("repoId"))));

const createTaskSchema = z.object({
  repoId: z.string().min(1),
  prompt: z.string().trim().min(1).max(20_000),
  provider: z.enum(["claude-code", "mock"]),
  permissionMode: z.enum(["plan", "acceptEdits"]),
});

function makeTitle(prompt: string): string {
  const firstLine = prompt.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

app.post("/api/tasks", async (c) => {
  const parsed = createTaskSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid task" }, 400);
  if (!repos.get(parsed.data.repoId)) return c.json({ error: "Repo not found" }, 404);

  const task: Task = {
    id: nanoid(12),
    ...parsed.data,
    title: makeTitle(parsed.data.prompt),
    status: "queued",
    costUsd: null,
    durationMs: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  tasks.insert(task);

  // Run in the background; progress is delivered through the SSE stream.
  void startTask(task).catch((err) => console.error(`Task ${task.id} crashed`, err));

  return c.json(task, 201);
});

app.get("/api/tasks/:id", (c) => {
  const task = tasks.get(c.req.param("id"));
  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json({ task, events: events.list(task.id) });
});

app.post("/api/tasks/:id/cancel", (c) => {
  const ok = cancelTask(c.req.param("id"));
  return ok ? c.json({ ok }) : c.json({ error: "Task is not running" }, 409);
});

/**
 * Server-Sent Events: replays stored events after `Last-Event-ID` (or `?after=`),
 * then streams live ones. Sends an `end` event once the task has finished so the
 * browser can close the connection instead of reconnecting.
 */
app.get("/api/tasks/:id/stream", (c) => {
  const taskId = c.req.param("id");
  if (!tasks.get(taskId)) return c.json({ error: "Task not found" }, 404);

  const after = Number(c.req.header("Last-Event-ID") ?? c.req.query("after") ?? 0) || 0;

  return streamSSE(c, async (stream) => {
    let lastSent = after;
    let finished = false;
    const queue: RunEvent[] = [];
    let wake: (() => void) | null = null;

    // Subscribe before reading history so no event is lost in between.
    const unsubscribe = bus.subscribe(taskId, (event) => {
      queue.push(event);
      wake?.();
    });
    stream.onAbort(() => {
      finished = true;
      wake?.();
    });

    const send = async (event: RunEvent) => {
      if (event.seq <= lastSent) return;
      lastSent = event.seq;
      await stream.writeSSE({ event: "run", id: String(event.seq), data: JSON.stringify(event) });
      if (event.type === "status" && isTerminalStatus(event.status)) finished = true;
    };

    try {
      for (const event of events.list(taskId, after)) await send(event);
      const task = tasks.get(taskId);
      if (task && isTerminalStatus(task.status)) finished = true;

      while (!finished) {
        if (queue.length === 0) {
          // Wait for the next event, with a heartbeat to keep proxies from closing the connection.
          await new Promise<void>((r) => {
            wake = r;
            setTimeout(r, 15_000);
          });
          wake = null;
          if (queue.length === 0 && !finished) await stream.writeSSE({ event: "ping", data: "" });
        }
        while (queue.length > 0) await send(queue.shift()!);
      }

      if (!stream.aborted) await stream.writeSSE({ event: "end", data: "" });
    } finally {
      unsubscribe();
    }
  });
});

const interrupted = tasks.failInterrupted();
if (interrupted > 0) console.log(`Marked ${interrupted} interrupted task(s) as error.`);

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Forgeboard server on http://${config.host}:${info.port}`);
  console.log(`Data: ${config.dataDir}`);
});
