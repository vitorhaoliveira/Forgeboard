"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { Button, Card, Chip, SectionLabel } from "./ui";
import { WorkspaceTile } from "./workspace-ui";

export function SettingsView() {
  const t = useTranslations("settings");
  const tw = useTranslations("ws");
  const tws = useTranslations("wsSettings");
  const { workspaces, repos, providers, refreshWorkspaces, setNewWorkspaceOpen } = useAppState();

  async function unarchive(id: string) {
    await api.updateWorkspace(id, { archived: false });
    await refreshWorkspaces();
  }

  return (
    <main className="flex justify-center px-8 py-7">
      <div className="flex w-full max-w-[860px] flex-col gap-6">
        <h1 className="text-[22px] font-semibold">{t("title")}</h1>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>{t("workspaces").toUpperCase()}</SectionLabel>
            <Button onClick={() => setNewWorkspaceOpen(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              {tw("create")}
            </Button>
          </div>
          <Card className="divide-y divide-border">
            {workspaces.map((ws) => (
              <div key={ws.id} className={cn("flex items-center gap-3 px-4 py-3 text-[13px]", ws.archived && "opacity-70")}>
                <WorkspaceTile workspace={ws} size={26} />
                <span className="font-medium">{ws.name}</span>
                <span className="text-xs text-muted">{tw("repoCount", { count: repos.filter((r) => r.workspaceId === ws.id).length })}</span>
                {ws.archived && <Chip>{t("archived")}</Chip>}
                <span className="ml-auto flex gap-2">
                  {ws.archived && (
                    <Button variant="ghost" onClick={() => unarchive(ws.id)}>
                      {tws("unarchive")}
                    </Button>
                  )}
                  <Link href={`/w/${ws.id}/settings`} className="inline-flex h-[34px] items-center px-2 text-[13px] text-accent">
                    {tw("configure")}
                  </Link>
                </span>
              </div>
            ))}
          </Card>
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>{t("providers").toUpperCase()}</SectionLabel>
          <Card className="divide-y divide-border">
            {providers.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                <span className={cn("size-2 rounded-full", p.available ? "bg-success" : "bg-danger")} aria-hidden="true" />
                <span className="font-medium">{p.label}</span>
                <span className="min-w-0 truncate text-xs text-muted">{p.detail}</span>
                <span className={cn("ml-auto text-xs", p.available ? "text-success" : "text-danger")}>{p.available ? t("available") : t("missing")}</span>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </main>
  );
}
