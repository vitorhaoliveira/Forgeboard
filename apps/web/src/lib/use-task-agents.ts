import { useMemo } from "react";
import type { Task } from "@forgeboard/shared";
import { useAppState } from "./app-state";
import { flowOf, lastBuilder, lastReviewer, mainBuilder, roleOfIn } from "./flow-view";

/** Who does what in a task's flow, for cards and screens that name agents. */
export function useTaskAgents(task: Pick<Task, "flow" | "workspaceId">) {
  const { crews } = useAppState();
  return useMemo(() => {
    const flow = flowOf(task);
    const roleOf = roleOfIn(crews[task.workspaceId] ?? crews.default);
    return {
      flow,
      roleOf,
      /** The first builder: who the task is "for" (Forge in Build & Review). */
      builder: mainBuilder(flow, roleOf),
      /** The last builder: where your notes and messages go. */
      notesTo: lastBuilder(flow, roleOf),
      /** The last reviewer (Hawk in Build & Review). */
      reviewer: lastReviewer(flow, roleOf),
    };
  }, [crews, task]);
}
