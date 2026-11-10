"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useAppState } from "@/lib/app-state";
import { formatCost, timeAgo } from "@/lib/utils";
import { StatusChip } from "./status-chip";
import { Card } from "./ui";

export function RunsView() {
  const t = useTranslations("runs");
  const locale = useLocale();
  const { tasks } = useAppState();

  return (
    <main className="flex justify-center px-8 py-7">
      <div className="flex w-full max-w-[1080px] flex-col gap-5">
        <h1 className="text-[22px] font-semibold">{t("title")}</h1>
        {tasks.length === 0 ? (
          <p className="text-muted">{t("empty")}</p>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 font-medium">{t("task")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("status")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("cost")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("when")}</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className="border-b border-border last:border-0 hover:bg-panel-2">
                    <td className="max-w-[420px] px-4 py-3">
                      <Link href={task.status === "review" ? `/runs/${task.id}/decide` : `/runs/${task.id}`} className="block truncate hover:underline">
                        {task.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip status={task.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted">{formatCost(task.costUsd, locale)}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted">{timeAgo(task.createdAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </main>
  );
}
