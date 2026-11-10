/**
 * Forgeboard's A2UI catalog: the only components an agent's form can use.
 *
 * Agents describe a form with a small JSON (AgentForm). The server compiles it to
 * A2UI v0.9 messages and validates them against this catalog in strict mode, so
 * nothing outside the catalog ever reaches the browser. The web app renders the
 * same component APIs with its own React implementations.
 */
import { z } from "zod";
import { STRICT_VALIDATION } from "@a2ui/web_core";
import { Catalog, CommonSchemas, MessageProcessor } from "@a2ui/web_core/v0_9";
import type { AgentForm, FormAnswer, FormField, FormFieldType, PlanStep } from "./index";

export const FORM_CATALOG_ID = "https://forgeboard.dev/catalogs/forms/v1.json";
export const SUBMIT_ACTION = "answer";

export const FormApis = {
  Column: {
    name: "Column",
    schema: z.object({ children: CommonSchemas.ChildList }).describe("Stacks its children vertically."),
  },
  Text: {
    name: "Text",
    schema: z.object({ text: CommonSchemas.DynamicString }).describe("Short context, markdown allowed."),
  },
  Choice: {
    name: "Choice",
    schema: z
      .object({
        label: CommonSchemas.DynamicString,
        hint: z.string().optional(),
        options: z.array(z.string()),
        suggested: z.number().optional(),
        value: CommonSchemas.DynamicString,
      })
      .describe("Pick one option."),
  },
  MultiChoice: {
    name: "MultiChoice",
    schema: z
      .object({
        label: CommonSchemas.DynamicString,
        hint: z.string().optional(),
        options: z.array(z.string()),
        value: CommonSchemas.DynamicStringList,
      })
      .describe("Pick any number of options."),
  },
  Toggle: {
    name: "Toggle",
    schema: z
      .object({ label: CommonSchemas.DynamicString, hint: z.string().optional(), value: CommonSchemas.DynamicBoolean })
      .describe("A yes/no decision."),
  },
  TextInput: {
    name: "TextInput",
    schema: z
      .object({
        label: CommonSchemas.DynamicString,
        hint: z.string().optional(),
        mono: z.boolean().optional(),
        value: CommonSchemas.DynamicString,
      })
      .describe("A short text answer."),
  },
  StepList: {
    name: "StepList",
    schema: z
      .object({ label: CommonSchemas.DynamicString, steps: CommonSchemas.DynamicValue })
      .describe("Plan steps the user can include, reorder and rewrite."),
  },
  Submit: {
    name: "Submit",
    schema: z.object({ label: CommonSchemas.DynamicString, action: CommonSchemas.Action }).describe("Sends the answers back."),
  },
} as const;

const validationCatalog = new Catalog(FORM_CATALOG_ID, "v0.9", Object.values(FormApis), []);

const LIMITS = { fields: 6, options: 6, steps: 12, label: 140, text: 400 };
const TYPES: FormFieldType[] = ["choice", "multi", "toggle", "text", "steps"];

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Cleans up what an agent sent; returns null when there is nothing usable. */
export function normalizeForm(raw: unknown): AgentForm | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.title, LIMITS.label);
  if (!title || !Array.isArray(r.fields)) return null;
  const seen = new Set<string>();
  const fields: FormField[] = [];
  for (const f of r.fields.slice(0, LIMITS.fields)) {
    if (!f || typeof f !== "object") continue;
    const ff = f as Record<string, unknown>;
    const type = ff.type as FormFieldType;
    const label = str(ff.label, LIMITS.label);
    let id = str(ff.id, 32).replace(/[^a-zA-Z0-9_]/g, "_") || `f${fields.length + 1}`;
    if (!TYPES.includes(type) || !label) continue;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    const field: FormField = { id, type, label, hint: str(ff.hint, LIMITS.text) || undefined };
    if (type === "choice" || type === "multi") {
      field.options = (Array.isArray(ff.options) ? ff.options : []).map((o) => str(o, LIMITS.label)).filter(Boolean).slice(0, LIMITS.options);
      if (field.options.length < 2) continue;
      if (type === "choice" && typeof ff.suggested === "number" && ff.suggested >= 0 && ff.suggested < field.options.length) field.suggested = ff.suggested;
      if (type === "multi" && Array.isArray(ff.value)) field.value = ff.value.filter((v): v is string => field.options!.includes(v as string));
    } else if (type === "toggle") {
      field.value = ff.value === true;
    } else if (type === "text") {
      field.value = str(ff.value, LIMITS.text);
      field.mono = ff.mono === true;
    } else if (type === "steps") {
      const steps = (Array.isArray(ff.value) ? ff.value : [])
        .map((s): PlanStep | null => {
          const text = typeof s === "string" ? str(s, LIMITS.label) : str((s as PlanStep)?.text, LIMITS.label);
          return text ? { text, estimate: str((s as PlanStep)?.estimate, 24) || undefined, included: true } : null;
        })
        .filter((s): s is PlanStep => s !== null)
        .slice(0, LIMITS.steps);
      if (steps.length === 0) continue;
      field.value = steps;
    }
    fields.push(field);
  }
  if (fields.length === 0) return null;
  const kind = r.kind === "plan" && fields.some((f) => f.type === "steps") ? "plan" : "questions";
  return { kind, title, context: str(r.context, LIMITS.text) || undefined, fields, submitLabel: str(r.submitLabel, 40) || undefined };
}

/** The answer the form starts with (the agent's defaults and suggestions). */
export function defaultAnswer(form: AgentForm): FormAnswer {
  const data: FormAnswer = {};
  for (const f of form.fields) {
    if (f.type === "choice") data[f.id] = f.options![f.suggested ?? 0]!;
    else if (f.type === "multi") data[f.id] = (f.value as string[] | undefined) ?? [];
    else if (f.type === "toggle") data[f.id] = f.value === true;
    else if (f.type === "text") data[f.id] = (f.value as string | undefined) ?? "";
    else data[f.id] = (f.value as PlanStep[]).map((s) => ({ ...s, included: s.included !== false }));
  }
  return data;
}

/** Compiles a form to A2UI v0.9 messages for one surface. */
export function compileForm(form: AgentForm, surfaceId: string, submitLabel: string): unknown[] {
  const components: Record<string, unknown>[] = [];
  const children: string[] = [];
  if (form.context) {
    components.push({ id: "context", component: "Text", text: form.context });
    children.push("context");
  }
  for (const f of form.fields) {
    const id = `field_${f.id}`;
    const value = { path: `/${f.id}` };
    const base = { id, label: f.label, ...(f.hint ? { hint: f.hint } : {}) };
    if (f.type === "choice") components.push({ ...base, component: "Choice", options: f.options, ...(f.suggested !== undefined ? { suggested: f.suggested } : {}), value });
    else if (f.type === "multi") components.push({ ...base, component: "MultiChoice", options: f.options, value });
    else if (f.type === "toggle") components.push({ ...base, component: "Toggle", value });
    else if (f.type === "text") components.push({ ...base, component: "TextInput", ...(f.mono ? { mono: true } : {}), value });
    else components.push({ id, component: "StepList", label: f.label, steps: value });
    children.push(id);
  }
  components.push({
    id: "submit",
    component: "Submit",
    label: form.submitLabel ?? submitLabel,
    action: { event: { name: SUBMIT_ACTION, context: Object.fromEntries(form.fields.map((f) => [f.id, { path: `/${f.id}` }])) } },
  });
  children.push("submit");
  components.unshift({ id: "root", component: "Column", children });

  return [
    { version: "v0.9", createSurface: { surfaceId, catalogId: FORM_CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId, components } },
    { version: "v0.9", updateDataModel: { surfaceId, path: "/", value: defaultAnswer(form) } },
  ];
}

/** Throws when the messages use anything outside Forgeboard's catalog. */
export function validateUi(messages: unknown[]): void {
  const processor = new MessageProcessor([validationCatalog], undefined, { validationConfig: STRICT_VALIDATION });
  processor.processMessages(messages as never);
}

/** A one-line, human-readable version of the answers, for the activity feed and the agent. */
export function summarizeAnswer(form: AgentForm, data: FormAnswer, yes: string, no: string): string {
  return form.fields
    .map((f) => {
      const v = data[f.id];
      if (f.type === "steps") {
        const steps = (v as PlanStep[]) ?? [];
        return `${f.label}: ${steps.filter((s) => s.included !== false).length}/${steps.length}`;
      }
      const shown = typeof v === "boolean" ? (v ? yes : no) : Array.isArray(v) ? (v as string[]).join(", ") || "—" : String(v ?? "—") || "—";
      return `${f.label}: ${shown}`;
    })
    .join(" · ");
}

/** Keeps only answers that fit the form; anything missing or malformed falls back to the default. */
export function sanitizeAnswer(form: AgentForm, raw: unknown): FormAnswer {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const data = defaultAnswer(form);
  for (const f of form.fields) {
    const v = input[f.id];
    if (f.type === "choice" && typeof v === "string" && f.options!.includes(v)) data[f.id] = v;
    else if (f.type === "multi" && Array.isArray(v)) data[f.id] = f.options!.filter((o) => v.includes(o));
    else if (f.type === "toggle" && typeof v === "boolean") data[f.id] = v;
    else if (f.type === "text" && typeof v === "string") data[f.id] = v.trim().slice(0, LIMITS.text);
    else if (f.type === "steps" && Array.isArray(v)) {
      const steps = v
        .map((s): PlanStep | null => {
          const text = str((s as PlanStep)?.text, LIMITS.label);
          return text ? { text, estimate: str((s as PlanStep)?.estimate, 24) || undefined, included: (s as PlanStep).included !== false } : null;
        })
        .filter((s): s is PlanStep => s !== null)
        .slice(0, LIMITS.steps + 4);
      if (steps.length) data[f.id] = steps;
    }
  }
  return data;
}
