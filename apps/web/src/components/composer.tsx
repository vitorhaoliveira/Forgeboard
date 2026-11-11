"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2, SendHorizontal } from "lucide-react";
import { isFinished, type MessageDelivery, type Task } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useTaskAgents } from "@/lib/use-task-agents";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

/**
 * Talk to the crew from the run screen. What a message does depends on the task:
 * an answer while it waits, a send-back with notes during review, and a message
 * Forge reads now (or at its next step) while it works.
 */
export function Composer({ task, autoFocus, activeBuilder }: { task: Task; autoFocus?: boolean; activeBuilder?: string | null }) {
  const t = useTranslations("composer2");
  const { agentName, refreshTasks, workspace } = useAppState();
  const [text, setText] = useState("");
  const [delivery, setDelivery] = useState<MessageDelivery>(workspace(task.workspaceId)?.messageDelivery ?? "now");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { notesTo } = useTaskAgents(task);
  // Who reads it: the agent that asked, the builder working now, or the last builder (where notes go).
  const forge = agentName(
    (task.status === "waiting" && task.question?.askedBy) || (task.status === "running" && activeBuilder) || notesTo,
    task.workspaceId,
  );

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  if (isFinished(task.status) || task.status === "queued") {
    return <div className="border-t border-border px-4 py-3 text-xs text-muted">{t("finished")}</div>;
  }

  const q = task.status === "waiting" ? task.question : null;
  const suggestions = q && !q.form ? q.options : [];
  const placeholder =
    task.status === "waiting" ? t("placeholderWaiting", { name: forge }) : task.status === "review" ? t("placeholderReview", { name: forge }) : t("placeholderRunning", { name: forge });

  async function send(value: string, viaSuggestion = false) {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (viaSuggestion) await api.answer(task.id, body, false);
      else await api.message(task.id, body, delivery);
      setText("");
      void refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(text);
    }
  }

  return (
    <div className="flex flex-col gap-2.5 border-t border-border px-4 py-3">
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label={t("suggestions")}>
          {suggestions.map((option, i) => (
            <button
              key={option}
              type="button"
              disabled={busy}
              onClick={() => void send(option, true)}
              className={cn(
                "inline-flex h-7 items-center rounded-full border px-2.5 text-[12.5px] transition disabled:opacity-50",
                i === q?.suggested ? "border-accent/45 bg-accent/[0.07] text-[#fdba74]" : "border-border bg-panel-2 hover:border-border-strong",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {q?.form && <p className="text-[12px] text-muted">{t("formHint")}</p>}
      <div className="flex flex-col gap-2 rounded-xl border border-border-strong bg-panel px-3 py-2.5 focus-within:border-text/30">
        <label htmlFor={`composer-${task.id}`} className="sr-only">
          {placeholder}
        </label>
        <textarea
          id={`composer-${task.id}`}
          ref={ref}
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          className="max-h-40 min-h-[44px] resize-none bg-transparent text-[13.5px] outline-none placeholder:text-muted"
        />
        <div className="flex flex-wrap items-center gap-2">
          {task.status === "running" && (
            <div role="radiogroup" aria-label={t("delivery")} className="inline-flex rounded-lg border border-border bg-bg p-0.5">
              {(["now", "later"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={delivery === d}
                  onClick={() => setDelivery(d)}
                  className={cn("rounded-md px-2 py-1 text-[11.5px] whitespace-nowrap", delivery === d ? "bg-panel-2 text-text" : "text-muted hover:text-text")}
                >
                  {d === "now" ? t("now") : t("later")}
                </button>
              ))}
            </div>
          )}
          <span className="ml-auto text-[11px] text-muted">{task.status === "running" ? "" : t("enterHint")}</span>
          <Button variant="primary" className="h-[30px]" disabled={!text.trim() || busy} onClick={() => void send(text)} aria-label={t("send")}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <SendHorizontal className="size-3.5" aria-hidden="true" />}
            {t("send")}
          </Button>
        </div>
      </div>
      {task.status === "review" && <p className="text-[11.5px] text-muted">{t("reviewHint", { name: agentName(notesTo, task.workspaceId) })}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
