"use client";

import { useEffect, useState } from "react";
import { isTerminalStatus, type RunEvent, type Task } from "@forgeboard/shared";
import { api } from "./api";

/**
 * Loads a task with its stored events, then follows new events over SSE
 * until the server signals the end of the run.
 */
export function useTaskStream(taskId: string) {
  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;

    setTask(null);
    setEvents([]);
    setError(null);

    api
      .task(taskId)
      .then(({ task: loaded, events: stored }) => {
        if (cancelled) return;
        setTask(loaded);
        setEvents(stored);
        if (isTerminalStatus(loaded.status)) return;

        source = new EventSource(api.streamUrl(taskId, stored.at(-1)?.seq ?? 0));

        source.addEventListener("run", (msg) => {
          const event = JSON.parse((msg as MessageEvent<string>).data) as RunEvent;
          setEvents((prev) => (prev.some((e) => e.seq === event.seq) ? prev : [...prev, event]));
          if (event.type === "status") {
            setTask((t) => (t ? { ...t, status: event.status } : t));
          } else if (event.type === "result") {
            setTask((t) => (t ? { ...t, costUsd: event.costUsd, durationMs: event.durationMs } : t));
          }
        });

        source.addEventListener("end", () => {
          source?.close();
          // Pick up final fields (finishedAt, cost) written by the server.
          api
            .task(taskId)
            .then((r) => !cancelled && setTask(r.task))
            .catch(() => {});
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [taskId]);

  return { task, events, error };
}
