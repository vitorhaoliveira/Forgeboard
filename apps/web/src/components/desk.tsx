"use client";

import { useTranslations } from "next-intl";
import { FolderGit2 } from "lucide-react";
import { isActive, isFinished } from "@forgeboard/shared";
import { useAppState } from "@/lib/app-state";
import { QuestionCard, RecentRow, ReviewCard, WorkingCard } from "./desk-cards";
import { RepoSwitcher, TopBar } from "./top-bar";
import { Card, SectionLabel } from "./ui";

export function Desk() {
  const t = useTranslations("desk");
  const tr = useTranslations("repo");
  const { tasks, repos, loaded } = useAppState();

  if (loaded && repos.length === 0) {
    return (
      <main className="grid grow place-items-center px-6">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <FolderGit2 className="size-8 text-muted" aria-hidden="true" />
          <h1 className="text-2xl font-semibold tracking-tight">{tr("noneTitle")}</h1>
          <p className="text-muted">{tr("noneBody")}</p>
          <RepoSwitcher />
        </div>
      </main>
    );
  }

  const waiting = tasks.filter((x) => x.status === "waiting");
  const review = tasks.filter((x) => x.status === "review");
  const working = tasks.filter((x) => isActive(x.status));
  const recent = tasks.filter((x) => isFinished(x.status)).slice(0, 6);
  const count = waiting.length + review.length;

  return (
    <>
      <TopBar />
      <main className="flex justify-center px-8 py-7">
        <div className="flex w-full max-w-[1240px] flex-col gap-6">
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{count > 0 ? t("headline", { count }) : t("headlineNone")}</h1>
            <p className="mt-1.5 text-muted">{t("sub", { count: working.length })}</p>
          </div>

          <div className="flex flex-wrap items-start gap-5">
            <section aria-label={t("needsYou")} className="flex min-w-0 grow-[999] basis-[560px] flex-col gap-3">
              <SectionLabel>{t("needsYou")}</SectionLabel>
              {count === 0 && (
                <Card className="border-dashed p-6 text-[13.5px] text-muted">
                  {t("nothingWaiting")} {tasks.length === 0 && t("startHint")}
                </Card>
              )}
              {waiting.map((task) => (
                <QuestionCard key={task.id} task={task} />
              ))}
              {review.map((task) => (
                <ReviewCard key={task.id} task={task} />
              ))}
            </section>

            <aside aria-label={t("atWork")} className="flex max-w-[420px] grow basis-[340px] flex-col gap-3">
              <SectionLabel>{t("atWork")}</SectionLabel>
              {working.length === 0 && <p className="text-[13px] text-muted">{t("nobodyWorking")}</p>}
              {working.map((task) => (
                <WorkingCard key={task.id} task={task} />
              ))}
              {recent.length > 0 && (
                <>
                  <SectionLabel className="mt-2">{t("recent")}</SectionLabel>
                  <Card className="divide-y divide-border px-3.5 py-1">
                    {recent.map((task) => (
                      <RecentRow key={task.id} task={task} />
                    ))}
                  </Card>
                </>
              )}
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
