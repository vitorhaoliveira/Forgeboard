"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, RotateCcw } from "lucide-react";
import type { Agent, Personality, ProviderId } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { Glyph } from "./glyph";
import { RulesEditor } from "./rules-editor";
import { Button, Chip, SectionLabel } from "./ui";

const PERSONALITIES: Personality[] = ["mentor", "balanced", "strict"];

/** Edits one agent: the default crew's, or a workspace's own when workspaceId is given. */
export function AgentCard({ agent, workspaceId }: { agent: Agent; workspaceId?: string }) {
  const t = useTranslations("crew");
  const tc = useTranslations("common");
  const tws = useTranslations("wsSettings");
  const { providers, refreshCrews, refreshWorkspaces } = useAppState();
  const [draft, setDraft] = useState(agent);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const dirty =
    draft.name !== agent.name || draft.provider !== agent.provider || draft.personality !== agent.personality || draft.instructions !== agent.instructions;

  useEffect(() => setDraft(agent), [agent]);

  async function run(action: () => Promise<unknown>) {
    setState("saving");
    setError(null);
    try {
      await action();
      await Promise.all([refreshCrews(), refreshWorkspaces()]);
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  }

  const save = () =>
    run(() =>
      api.updateAgent(agent.id, { name: draft.name, provider: draft.provider, personality: draft.personality, instructions: draft.instructions }, workspaceId),
    );
  const reset = () => run(() => api.resetAgent(agent.id, workspaceId!));

  const id = `agent-${workspaceId ?? "default"}-${agent.id}`;
  return (
    <article className={cn("flex flex-col gap-4 rounded-2xl border border-border bg-panel p-[18px]", agent.id === "hawk" && "border-info/25")}>
      <div className="flex items-center gap-3">
        <Glyph actor={agent.id} size={44} className="rounded-[13px]" />
        <div className="min-w-0 grow">
          <label htmlFor={`${id}-name`} className="sr-only">
            {t("name")}
          </label>
          <input
            id={`${id}-name`}
            value={draft.name}
            maxLength={24}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold outline-none hover:border-border focus:border-border-strong"
          />
          <div className="px-1 text-[12.5px] text-muted">{agent.id === "forge" ? t("roleForge") : t("roleHawk")}</div>
        </div>
        {workspaceId && agent.customized && <Chip tone="info">{t("customized")}</Chip>}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("personality").toUpperCase()}</SectionLabel>
        <div role="radiogroup" aria-label={t("personality")} className="grid grid-cols-3 rounded-[9px] border border-border bg-bg p-[3px] text-[12.5px]">
          {PERSONALITIES.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={draft.personality === p}
              onClick={() => setDraft({ ...draft, personality: p })}
              className={cn("h-7 rounded-md", draft.personality === p ? "bg-panel-2 shadow-[inset_0_0_0_1px_var(--border)]" : "text-muted hover:text-text")}
            >
              {t(p)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-provider`}>
          <SectionLabel>{t("runsOn").toUpperCase()}</SectionLabel>
        </label>
        <select
          id={`${id}-provider`}
          value={draft.provider}
          onChange={(e) => setDraft({ ...draft, provider: e.target.value as ProviderId })}
          className="h-[34px] rounded-lg border border-border bg-panel-2 px-2.5 text-[13px] outline-none"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.available}>
              {p.label}
              {!p.available ? ` (${t("notInstalled")})` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-instructions`}>
          <SectionLabel>{t("instructions").toUpperCase()}</SectionLabel>
        </label>
        <textarea
          id={`${id}-instructions`}
          rows={3}
          value={draft.instructions}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          className="resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13px] outline-none focus:border-border-strong"
        />
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        {workspaceId && agent.customized && (
          <Button variant="ghost" onClick={reset} disabled={state === "saving"}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {tws("resetAgent")}
          </Button>
        )}
        <Button variant="primary" onClick={save} disabled={!dirty || state === "saving" || !draft.name.trim()}>
          {state === "saving" && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {state === "saved" && <Check className="size-3.5" aria-hidden="true" />}
          {state === "saved" ? tc("saved") : tc("save")}
        </Button>
      </div>
    </article>
  );
}

/** The default crew and the general house rules, which apply everywhere. */
export function CrewView() {
  const t = useTranslations("crew");
  const { crews } = useAppState();
  return (
    <div className="flex grow flex-wrap">
      <main className="flex min-w-0 grow-[999] basis-[600px] flex-col gap-5 px-[30px] py-[26px]">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-muted">{t("subtitle")}</p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5">
          {(crews.default ?? []).map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
        </div>
      </main>
      <aside className="max-w-[460px] grow basis-[340px] border-l border-border bg-panel px-[22px] py-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold">{t("rules")}</h2>
          <p className="mt-1 text-[13px] text-muted">{t("rulesSubtitle")}</p>
        </div>
        <RulesEditor scope="global" id={null} placeholder={t("addRule")} />
      </aside>
    </div>
  );
}
