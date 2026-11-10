import type { RunEventPayload, Task, TaskStatus } from "@forgeboard/shared";
import { bus } from "./bus.js";
import { events, repos, tasks } from "./db.js";
import { getProvider } from "./providers/index.js";

/** Abort handles for tasks currently running in this process. */
const running = new Map<string, AbortController>();

function emit(taskId: string, payload: RunEventPayload): void {
  const event = { ...payload, taskId, seq: events.lastSeq(taskId) + 1, ts: new Date().toISOString() };
  events.insert(event);
  bus.publish(event);
}

export function isRunning(taskId: string): boolean {
  return running.has(taskId);
}

export async function startTask(task: Task): Promise<void> {
  const repo = repos.get(task.repoId);
  if (!repo) throw new Error(`Repo ${task.repoId} not found`);

  const controller = new AbortController();
  running.set(task.id, controller);

  tasks.setStatus(task.id, "running");
  emit(task.id, { type: "status", status: "running" });

  let status: TaskStatus = "error";
  let costUsd: number | null = null;
  let durationMs: number | null = null;

  try {
    await getProvider(task.provider).run({
      prompt: task.prompt,
      cwd: repo.path,
      permissionMode: task.permissionMode,
      signal: controller.signal,
      emit: (payload) => {
        if (payload.type === "result") {
          status = "done";
          costUsd = payload.costUsd;
          durationMs = payload.durationMs;
        }
        emit(task.id, payload);
      },
    });
  } catch (err) {
    emit(task.id, { type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    running.delete(task.id);
    if (controller.signal.aborted) status = "cancelled";
    tasks.finish(task.id, status, costUsd, durationMs);
    emit(task.id, { type: "status", status });
  }
}

export function cancelTask(taskId: string): boolean {
  const controller = running.get(taskId);
  if (!controller) return false;
  controller.abort();
  return true;
}
