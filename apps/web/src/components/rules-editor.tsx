"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import type { HouseRule, RuleScope } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "./ui";

export interface RuleTarget {
  label: string;
  scope: RuleScope;
  id: string | null;
}

/** Lists, adds, toggles, deletes and moves the rules of one level. */
export function RulesEditor({
  scope,
  id,
  placeholder,
  moveTargets = [],
  onChange,
}: {
  scope: RuleScope;
  id: string | null;
  placeholder: string;
  /** Other levels a rule can be moved to. */
  moveTargets?: RuleTarget[];
  onChange?: () => void;
}) {
  const t = useTranslations("crew");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [list, setList] = useState<HouseRule[]>([]);
  const [text, setText] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .rules(scope, id ?? undefined)
        .then((r) => alive && setList(r))
        .catch(() => {});
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [scope, id]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (text.trim().length < 3) return;
    const rule = await api.addRule(scope, id, text.trim());
    setList((l) => [rule, ...l]);
    setText("");
    onChange?.();
  }

  async function toggle(rule: HouseRule) {
    const next = await api.updateRule(rule.id, { enabled: !rule.enabled });
    setList((l) => l.map((r) => (r.id === rule.id ? next : r)));
  }

  async function remove(rule: HouseRule) {
    await api.removeRule(rule.id);
    setList((l) => l.filter((r) => r.id !== rule.id));
    onChange?.();
  }

  async function move(rule: HouseRule, target: RuleTarget) {
    await api.updateRule(rule.id, { scope: target.scope, id: target.id });
    setList((l) => l.filter((r) => r.id !== rule.id));
    onChange?.();
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={add} className="flex gap-2">
        <label htmlFor={`rule-${scope}-${id ?? "global"}`} className="sr-only">
          {placeholder}
        </label>
        <input
          id={`rule-${scope}-${id ?? "global"}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="h-[34px] min-w-0 grow rounded-lg border border-border bg-bg px-3 text-[13px] outline-none focus:border-border-strong"
        />
        <Button type="submit" disabled={text.trim().length < 3}>
          <Plus className="size-3.5" aria-hidden="true" />
          {tc("add")}
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
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  {t("source", { source: rule.source, time: timeAgo(rule.createdAt, locale) })}
                  {moveTargets.length > 0 && (
                    <select
                      aria-label={rule.text}
                      value=""
                      onChange={(e) => {
                        const target = moveTargets[Number(e.target.value)];
                        if (target) void move(rule, target);
                      }}
                      className="bg-transparent text-xs text-accent outline-none"
                    >
                      <option value="">→</option>
                      {moveTargets.map((m, i) => (
                        <option key={`${m.scope}-${m.id}`} value={i} className="bg-panel text-text">
                          {m.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(rule)}
                aria-label={`${tc("delete")}: ${rule.text}`}
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
