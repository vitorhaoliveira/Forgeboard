"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import type { Agent, HouseRule, Personality, ProviderId } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { cn, timeAgo } from "@/lib/utils";
import { Glyph } from "./glyph";
import { Button, SectionLabel } from "./ui";

const PERSONALITIES: Personality[] = ["mentor", "balanced", "strict"];

function AgentCard({ agent }: { agent: Agent }) {
  const t = useTranslations("crew");
  const tc = useTranslations("common");
  const { providers, refreshAgents } = useAppState();
  const [draft, setDraft] = useState(agent);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(agent);

  useEffect(() => setDraft(agent), [agent]);

  async function save() {
    setState("saving");
    setError(null);
    try {
      await api.updateAgent(agent.id, {
        name: draft.name,
        provider: draft.provider,
        personality: draft.personality,
        instructions: draft.instructions,
      });
      await refreshAgents();
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  }

  const id = `agent-${agent.id}`;
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
      <div className="flex justify-end">
        <Button variant="primary" onClick={save} disabled={!dirty || state === "saving" || !draft.name.trim()}>
          {state === "saving" && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {state === "saved" && <Check className="size-3.5" aria-hidden="true" />}
          {state === "saved" ? tc("saved") : tc("save")}
        </Button>
      </div>
    </article>
  );
}

function RulesPanel() {
  const t = useTranslations("crew");
  const locale = useLocale();
  const { selectedRepo } = useAppState();
  const [list, setList] = useState<HouseRule[]>([]);
  const [text, setText] = useState("");

  useEffect(() => {
    if (!selectedRepo) return;
    let alive = true;
    const load = () => api.rules(selectedRepo.id).then((r) => alive && setList(r)).catch(() => {});
    void load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [selectedRepo]);

  if (!selectedRepo) return <p className="text-[13px] text-muted">{t("rulesNoRepo")}</p>;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!selectedRepo || text.trim().length < 3) return;
    const rule = await api.addRule(selectedRepo.id, text.trim());
    setList((l) => [rule, ...l]);
    setText("");
  }

  async function toggle(rule: HouseRule) {
    const next = await api.updateRule(rule.id, { enabled: !rule.enabled });
    setList((l) => l.map((r) => (r.id === rule.id ? next : r)));
  }

  async function remove(rule: HouseRule) {
    await api.removeRule(rule.id);
    setList((l) => l.filter((r) => r.id !== rule.id));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {t("rules")}
          <span className="rounded-full border border-border bg-panel-2 px-2 font-mono text-[11.5px] font-normal text-muted">{selectedRepo.name}</span>
        </h2>
        <p className="mt-1 text-[13px] text-muted">{t("rulesSubtitle", { repo: selectedRepo.name })}</p>
      </div>
      <form onSubmit={add} className="flex gap-2">
        <label htmlFor="new-rule" className="sr-only">
          {t("addRule")}
        </label>
        <input
          id="new-rule"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("addRule")}
          className="h-[34px] min-w-0 grow rounded-lg border border-border bg-bg px-3 text-[13px] outline-none focus:border-border-strong"
        />
        <Button type="submit" disabled={text.trim().length < 3} aria-label={t("addRule")}>
          <Plus className="size-4" aria-hidden="true" />
        </Button>
      </form>
      {list.length === 0 ? (
        <p className="text-[13px] text-muted">{t("noRules")}</p>
      ) : (
        <ul>
          {list.map((rule) => (
            <li key={rule.id} className="group flex items-start gap-3 border-t border-border py-3 first:border-t-0">
              <button
                type="button"
                role="switch"
                aria-checked={rule.enabled}
                aria-label={t("toggleRule")}
                onClick={() => toggle(rule)}
                className={cn("relative mt-px h-[19px] w-8 shrink-0 rounded-full", rule.enabled ? "bg-accent" : "bg-[#2a313a]")}
              >
                <span className={cn("absolute top-0.5 size-[15px] rounded-full", rule.enabled ? "right-0.5 bg-bg" : "left-0.5 bg-muted")} />
              </button>
              <div className={cn("min-w-0 grow", !rule.enabled && "opacity-60")}>
                <div className="text-[13.5px]">{rule.text}</div>
                <div className="text-xs text-muted">{t("source", { source: rule.source, time: timeAgo(rule.createdAt, locale) })}</div>
              </div>
              <button
                type="button"
                onClick={() => remove(rule)}
                aria-label={`${t("rules")}: ${rule.text}`}
                className="grid size-7 shrink-0 place-items-center rounded-md text-muted opacity-0 group-hover:opacity-100 hover:text-danger focus:opacity-100"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CrewView() {
  const t = useTranslations("crew");
  const { agents } = useAppState();
  return (
    <div className="flex grow flex-wrap">
      <main className="flex min-w-0 grow-[999] basis-[600px] flex-col gap-5 px-[30px] py-[26px]">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{t("title")}</h1>
          <p className="mt-1 text-[13.5px] text-muted">{t("subtitle")}</p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5">
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
        </div>
      </main>
      <aside className="max-w-[440px] grow basis-[340px] border-l border-border bg-panel px-[22px] py-6">
        <RulesPanel />
      </aside>
    </div>
  );
}
