"use client";

/**
 * Renders an agent's form with A2UI. The server already compiled the form to A2UI
 * messages and checked them against Forgeboard's catalog; here the same catalog is
 * implemented with our own React components, and the processor runs strict again.
 * Loaded only in the browser (see agent-form-loader.tsx).
 */
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, GripVertical, Loader2 } from "lucide-react";
import { STRICT_VALIDATION } from "@a2ui/web_core";
import { Catalog, MessageProcessor } from "@a2ui/web_core/v0_9";
import { A2uiSurface, createComponentImplementation, type ReactCatalogComponent } from "@a2ui/react/v0_9";
import { FORM_CATALOG_ID, FormApis, SUBMIT_ACTION } from "@forgeboard/shared/a2ui";
import type { AgentForm, FormAnswer, PlanStep } from "@forgeboard/shared";
import { cn } from "@/lib/utils";
import { buttonClass } from "./ui";

// ---------- Chrome shared between the catalog components and the card ----------

interface FormChrome {
  form: AgentForm;
  busy: boolean;
  /** Wraps the primary button with the card's other actions. */
  footer: (primary: ReactNode) => ReactNode;
  plan: { included: number; total: number };
  setPlan: (plan: { included: number; total: number }) => void;
}

const ChromeContext = createContext<FormChrome | null>(null);
const useChrome = () => useContext(ChromeContext)!;

// ---------- Catalog implementations ----------

function Field({ label, hint, labelFor, children }: { label: string; hint?: string; labelFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {labelFor ? (
        <label htmlFor={labelFor} className="text-[13px] font-medium">
          {label}
        </label>
      ) : (
        <span className="text-[13px] font-medium">{label}</span>
      )}
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

const Column = createComponentImplementation(FormApis.Column, ({ props, buildChild }) => (
  <div className="flex flex-col gap-5">{props.children.map((child, i) => (
    // The resolved child ref is what buildChild expects at runtime; the types don't line up yet.
    <div key={i} className="contents">{buildChild(child as Parameters<typeof buildChild>[0])}</div>
  ))}</div>
));

const Text = createComponentImplementation(FormApis.Text, ({ props }) => <p className="-mt-1 text-[13.5px] text-muted">{props.text}</p>);

const Choice = createComponentImplementation(FormApis.Choice, ({ props }) => {
  const t = useTranslations("question");
  const options = props.options;
  function onKey(e: KeyboardEvent, i: number) {
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const n = (next + options.length) % options.length;
    props.setValue(options[n]!);
    (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
  }
  return (
    <Field label={props.label} hint={props.hint}>
      <div role="radiogroup" aria-label={props.label} className="flex flex-wrap gap-2">
        {options.map((option, i) => {
          const on = props.value === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => props.setValue(option)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-[9px] border px-[13px] text-[13px] transition",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                on ? "border-accent/60 bg-accent/8 text-[#fdba74]" : "border-border bg-panel-2 hover:border-border-strong",
              )}
            >
              <span className={cn("grid size-3.5 place-items-center rounded-full border-[1.5px]", on ? "border-accent" : "border-[#4a4a50]")}>
                {on && <span className="size-1.5 rounded-full bg-accent" />}
              </span>
              {option}
              {i === props.suggested && <span className="text-[11px] opacity-80">{t("suggested")}</span>}
            </button>
          );
        })}
      </div>
    </Field>
  );
});

const MultiChoice = createComponentImplementation(FormApis.MultiChoice, ({ props }) => {
  const value = props.value ?? [];
  return (
    <Field label={props.label} hint={props.hint}>
      <div role="group" aria-label={props.label} className="flex flex-col gap-1.5">
        {props.options.map((option) => (
          <label key={option} className="inline-flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              className="accent-accent"
              checked={value.includes(option)}
              onChange={(e) => props.setValue(e.target.checked ? [...value, option] : value.filter((v) => v !== option))}
            />
            {option}
          </label>
        ))}
      </div>
    </Field>
  );
});

const Toggle = createComponentImplementation(FormApis.Toggle, ({ props }) => {
  const t = useTranslations("form");
  const on = props.value === true;
  return (
    <Field label={props.label} hint={props.hint}>
      <span className="flex items-center gap-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={props.label}
          onClick={() => props.setValue(!on)}
          className={cn(
            "relative h-[21px] w-9 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            on ? "bg-accent" : "bg-border-strong",
          )}
        >
          <span className={cn("absolute top-0.5 size-[17px] rounded-full bg-bg transition-all", on ? "right-0.5" : "left-0.5")} />
        </button>
        <span className="text-[13px]">{on ? t("yes") : t("no")}</span>
      </span>
    </Field>
  );
});

const TextInput = createComponentImplementation(FormApis.TextInput, ({ props }) => {
  const id = useId();
  return (
    <Field label={props.label} hint={props.hint} labelFor={id}>
      <input
        id={id}
        value={props.value ?? ""}
        onChange={(e) => props.setValue(e.target.value)}
        className={cn(
          "h-[38px] max-w-[320px] rounded-[9px] border border-border bg-bg px-3 text-[13px] outline-none focus:border-border-strong",
          props.mono && "font-mono",
        )}
      />
    </Field>
  );
});

/** "~8 min" → 8. Anything else counts as 0. */
function minutes(estimate?: string): number {
  const m = estimate?.match(/(\d+)\s*min/);
  return m ? Number(m[1]) : 0;
}

const StepList = createComponentImplementation(FormApis.StepList, ({ props }) => {
  const t = useTranslations("form");
  const chrome = useChrome();
  const steps = (Array.isArray(props.steps) ? props.steps : []) as PlanStep[];
  const original = useRef(steps.map((s) => s.text));
  const [dragging, setDragging] = useState<number | null>(null);
  const [focusLast, setFocusLast] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  const included = steps.filter((s) => s.included !== false);
  const total = included.reduce((sum, s) => sum + minutes(s.estimate), 0);
  const { setPlan } = chrome;
  useEffect(() => setPlan({ included: included.length, total: steps.length }), [included.length, steps.length, setPlan]);
  useEffect(() => {
    if (!focusLast) return;
    listRef.current?.querySelector<HTMLInputElement>("li:last-child input")?.focus();
    setFocusLast(false);
  }, [focusLast]);

  const update = (next: PlanStep[]) => props.setSteps(next);
  const patch = (i: number, change: Partial<PlanStep>) => update(steps.map((s, j) => (j === i ? { ...s, ...change } : s)));
  function move(from: number, to: number) {
    if (to < 0 || to >= steps.length || from === to) return;
    const next = [...steps];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    update(next);
  }

  return (
    <div className="-mx-1 overflow-hidden rounded-xl border border-border bg-bg/40">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="text-[11px] font-medium tracking-[.05em] text-muted uppercase">{props.label}</span>
        <span className="text-xs text-muted">
          {t("stepsCount", { included: included.length, total: steps.length })}
          {total > 0 && ` · ~${total} min`}
        </span>
        <span className="ml-auto inline-flex h-[22px] items-center rounded-full border border-border bg-panel-2 px-2 text-[11.5px] text-muted">
          {t("dragHint")}
        </span>
      </div>
      <ol ref={listRef} className="m-0 list-none p-1">
        {steps.map((step, i) => {
          const on = step.included !== false;
          const edited = original.current[i] !== undefined && original.current.indexOf(step.text) === -1;
          return (
            <li
              key={i}
              draggable
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragging !== null && dragging !== i) {
                  move(dragging, i);
                  setDragging(i);
                }
              }}
              onDragEnd={() => setDragging(null)}
              className={cn(
                "flex items-center gap-2.5 border-t border-border px-3 py-2.5 first:border-t-0",
                !on && "opacity-50",
                edited && on && "bg-accent/5",
                dragging === i && "bg-panel-2",
              )}
            >
              <GripVertical className="size-4 flex-none cursor-grab text-[#4a4a50]" aria-hidden="true" />
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={t("includeStep", { n: i + 1 })}
                onClick={() => patch(i, { included: !on })}
                className={cn(
                  "grid size-[17px] flex-none place-items-center rounded-[5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  on ? "bg-accent text-bg" : "border-[1.5px] border-[#4a4a50]",
                )}
              >
                {on && <Check className="size-[11px]" strokeWidth={3.5} aria-hidden="true" />}
              </button>
              <span className="w-[18px] font-mono text-[11.5px] text-muted">{String(i + 1).padStart(2, "0")}</span>
              <input
                aria-label={t("stepLabel", { n: i + 1 })}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                value={step.text}
                placeholder={t("newStep")}
                onChange={(e) => patch(i, { text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    const to = i + (e.key === "ArrowUp" ? -1 : 1);
                    move(i, to);
                    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLInputElement>("li input")[to]?.focus());
                  }
                }}
                className={cn(
                  "h-[34px] min-w-0 grow rounded-[7px] border border-transparent bg-transparent px-2.5 text-[13.5px] outline-none hover:border-border focus:border-border-strong focus:bg-bg",
                  !on && "line-through",
                )}
              />
              {edited ? (
                <span className="inline-flex h-[22px] flex-none items-center rounded-full border border-accent/40 px-2 text-[11.5px] text-accent">{t("edited")}</span>
              ) : (
                step.estimate && <span className="flex-none font-mono text-[11.5px] text-muted">{step.estimate}</span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="px-4 pt-1 pb-3">
        <button
          type="button"
          onClick={() => {
            update([...steps, { text: "", included: true }]);
            setFocusLast(true);
          }}
          className="text-[13px] text-muted hover:text-text"
        >
          + {t("addStep")}
        </button>
      </div>
    </div>
  );
});

const Submit = createComponentImplementation(FormApis.Submit, ({ props }) => {
  const t = useTranslations("form");
  const chrome = useChrome();
  const isPlan = chrome.form.kind === "plan";
  const label = isPlan ? t("approve", { count: chrome.plan.included }) : props.label;
  return (
    <div className="mt-1 border-t border-border pt-4">
      {chrome.footer(
        <button
          type="button"
          className={buttonClass("primary", "h-9 px-3.5")}
          disabled={chrome.busy || (isPlan && chrome.plan.included === 0)}
          onClick={() => props.action()}
        >
          {chrome.busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {label}
        </button>,
      )}
    </div>
  );
});

const catalog = new Catalog(FORM_CATALOG_ID, "v0.9", [Column, Text, Choice, MultiChoice, Toggle, TextInput, StepList, Submit], []);

// ---------- The form ----------

export interface AgentFormProps {
  form: AgentForm;
  ui: unknown[];
  busy: boolean;
  onSubmit: (data: FormAnswer) => void;
  footer: (primary: ReactNode) => ReactNode;
}

export default function AgentFormView({ form, ui, busy, onSubmit, footer }: AgentFormProps) {
  const t = useTranslations("form");
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const [plan, setPlan] = useState({ included: 0, total: 0 });

  const surface = useMemo(() => {
    try {
      // Each processor reads its own surface (StrictMode may build two and keep one).
      let created: { dataModel: { get: (path: string) => unknown } } | null = null;
      const processor = new MessageProcessor<ReactCatalogComponent>(
        [catalog],
        (action: { name?: string; context?: Record<string, unknown> }) => {
          if (action.name !== SUBMIT_ACTION) return;
          // The action's context is resolved when Submit renders, which can be before the latest
          // edit. Read each answered path from the data model at submit time instead.
          const model = created?.dataModel;
          const keys = Object.keys(action.context ?? {});
          submitRef.current(Object.fromEntries(keys.map((k) => [k, model ? model.get(`/${k}`) : action.context![k]])) as FormAnswer);
        },
        { validationConfig: STRICT_VALIDATION },
      );
      processor.processMessages(ui as never);
      const surface = [...processor.model.surfacesMap.values()][0] ?? null;
      created = surface;
      return surface;
    } catch (err) {
      console.warn("[forgeboard] form rejected by the catalog", err);
      return null;
    }
  }, [ui]);

  const chrome = useMemo<FormChrome>(() => ({ form, busy, footer, plan, setPlan }), [form, busy, footer, plan]);

  if (!surface) return <p className="text-[13px] text-danger">{t("invalid")}</p>;
  return (
    <ChromeContext.Provider value={chrome}>
      <A2uiSurface surface={surface} />
    </ChromeContext.Provider>
  );
}
