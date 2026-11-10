"use client";

import { useCallback, useEffect, useState } from "react";
import { isFinished, type RunEvent, type Task } from "@forgeboard/shared";
import { api } from "./api";

/**
 * Loads a task with its stored events, then follows new events over SSE.
 * The task is re-fetched whenever its status changes so every field stays exact.
 */
export function useTaskStream(taskId: string) {
  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  /** Call after an action (answer, send back…) restarts a finished stream. */
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;

    const refetchTask = () =>
      api
        .task(taskId)
        .then((r) => !cancelled && setTask(r.task))
        .catch(() => {});

    api
      .task(taskId)
      .then(({ task: loaded, events: stored }) => {
        if (cancelled) return;
        setTask(loaded);
        setEvents(stored);
        setError(null);
        if (isFinished(loaded.status)) return;

        source = new EventSource(api.streamUrl(taskId, stored.at(-1)?.seq ?? 0));
        source.addEventListener("run", (msg) => {
          const event = JSON.parse((msg as MessageEvent<string>).data) as RunEvent;
          setEvents((prev) => (prev.some((e) => e.seq === event.seq) ? prev : [...prev, event]));
          if (event.type === "status" || event.type === "verdict" || event.type === "round" || event.type === "question") {
            void refetchTask();
          }
        });
        source.addEventListener("end", () => {
          source?.close();
          void refetchTask();
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [taskId, reloadKey]);

  return { task, events, error, reload };
}
