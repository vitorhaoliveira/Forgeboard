"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAppState } from "@/lib/app-state";
import { cn, formatCost, timeAgo } from "@/lib/utils";
import { StatusChip } from "./status-chip";
import { Card } from "./ui";
import { WorkspaceDot } from "./workspace-ui";

export function RunsView() {
  const t = useTranslations("runs");
  const locale = useLocale();
  const { tasks: all, workspaces, repo, workspace } = useAppState();
  const [filter, setFilter] = useState<string | null>(null);
  const tasks = filter ? all.filter((x) => x.workspaceId === filter) : all;
  const withTasks = workspaces.filter((w) => all.some((x) => x.workspaceId === w.id));

  return (
    <main className="flex justify-center px-8 py-7">
      <div className="flex w-full max-w-[1080px] flex-col gap-5">
        <h1 className="text-[22px] font-semibold">{t("title")}</h1>
        {withTasks.length > 1 && (
          <nav aria-label={t("workspace")} className="flex flex-wrap gap-1.5">
            {[{ id: null, name: t("all"), color: null }, ...withTasks].map((w) => (
              <button
                key={w.id ?? "all"}
                type="button"
                aria-pressed={filter === w.id}
                onClick={() => setFilter(w.id)}
                className={cn(
                  "inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12.5px]",
                  filter === w.id ? "border-border-strong bg-panel-2 text-text" : "border-transparent text-muted hover:text-text",
                )}
              >
                {w.color && <WorkspaceDot color={w.color} />}
                {w.name}
              </button>
            ))}
          </nav>
        )}
        {tasks.length === 0 ? (
          <p className="text-muted">{t("empty")}</p>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 font-medium">{t("task")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("workspace")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("status")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("cost")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("when")}</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const ws = workspace(task.workspaceId);
                  return (
                    <tr key={task.id} className="border-b border-border last:border-0 hover:bg-panel-2">
                      <td className="max-w-[360px] px-4 py-3">
                        <Link href={task.status === "review" ? `/runs/${task.id}/decide` : `/runs/${task.id}`} className="block truncate hover:underline">
                          {task.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                          {ws && <WorkspaceDot color={ws.color} />}
                          {ws?.name}
                          <span className="font-mono">/ {repo(task.repoId)?.name}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusChip status={task.status} workspaceId={task.workspaceId} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted">{formatCost(task.costUsd, locale)}</td>
                      <td className="px-4 py-3 text-right text-xs text-muted">{timeAgo(task.createdAt, locale)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </main>
  );
}
