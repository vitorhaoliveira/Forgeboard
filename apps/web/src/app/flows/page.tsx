"use client";

import { useTranslations } from "next-intl";
import { FlowGraph } from "@/components/flow-graph";

const IDLE = { task: "idle", forge: "idle", checks: "idle", hawk: "idle", you: "idle", merge: "idle" } as const;

export default function FlowsPage() {
  const t = useTranslations("flows");
  const tf = useTranslations("flow");
  return (
    <main className="flex justify-center px-8 py-7">
      <div className="flex w-full max-w-[1080px] flex-col gap-5">
        <div>
          <h1 className="text-[22px] font-semibold">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-muted">{t("body")}</p>
        </div>
        <section className="dot-grid overflow-x-auto rounded-2xl border border-border px-6 py-8">
          <h2 className="mb-4 text-[15px] font-semibold">{tf("name")}</h2>
          <FlowGraph states={{ ...IDLE, task: "done" }} loopLabel={tf("loopLabel", { max: 3 })} />
          <p className="mt-4 text-[13px] text-muted">{t("rounds", { max: 3 })}</p>
        </section>
      </div>
    </main>
  );
}
