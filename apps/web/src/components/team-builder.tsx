"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import {
  BUILD_AND_REVIEW_ID,
  LEAD_DECIDES_ID,
  MAX_DRAFT_MEMBERS,
  WORK_KINDS,
  type Locale,
  type Personality,
  type ProviderId,
  type Team,
  type TeamDraft,
  type TeamDraftMember,
  type WorkKind,
} from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { cn, formatCost } from "@/lib/utils";
import { ChooseFolderButton } from "./folder-picker";
import { useFlowName } from "./flow-graph";
import { actorColor } from "./glyph";
import { Button, Chip, SectionLabel } from "./ui";

const PERSONALITIES: Personality[] = ["mentor", "balanced", "strict"];
const field = "rounded-lg border border-border bg-bg px-2.5 text-[13px] outline-none focus:border-border-strong";

/** Asks the AI for a proposal; "Cancel" stops it. */
function useProposal() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  async function propose(input: Parameters<typeof api.proposeTeam>[0]) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(null);
    try {
      return await api.proposeTeam(input, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      if (abort.current === controller) setBusy(false);
    }
  }
  function cancel() {
    abort.current?.abort();
    setBusy(false);
  }
  return { busy, error, setError, propose, cancel };
}

function Working({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations("teams.ai");
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-bg px-3.5 py-3 text-[13px] text-muted" role="status">
      <Loader2 className="size-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
      <span className="grow">{t("working")}</span>
      <Button variant="ghost" onClick={onCancel}>
        {t("cancel")}
      </Button>
    </div>
  );
}

/** "Build with AI": describe a team, optionally point at a folder, get an editable proposal, create it. */
export function AiTeamBuilder({ onCreated }: { onCreated: (teamId: string) => void }) {
  const t = useTranslations("teams.ai");
  const locale = useLocale() as Locale;
  const { refreshTeams } = useAppState();
  const [request, setRequest] = useState("");
  const [path, setPath] = useState("");
  const [proposal, setProposal] = useState<{ draft: TeamDraft; summary: string; costUsd: number | null } | null>(null);
  const [change, setChange] = useState("");
  const [saving, setSaving] = useState(false);
  const p = useProposal();

  async function ask(again: boolean) {
    const text = again && change.trim() ? `${request.trim()}\n\n${change.trim()}` : request.trim();
    const result = await p.propose({ request: text, ...(path.trim() ? { path: path.trim() } : {}), ...(again && proposal ? { previous: proposal.draft } : {}), locale });
    if (result) {
      setProposal(result);
      setChange("");
    }
  }

  async function create() {
    if (!proposal) return;
    setSaving(true);
    p.setError(null);
    try {
      const { draft } = proposal;
      const team = await api.createTeam({ name: draft.name.trim() || t("defaultName"), description: draft.description.trim(), draft, locale });
      await refreshTeams();
      onCreated(team.id);
    } catch (err) {
      p.setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-3.5 rounded-2xl border border-accent/35 bg-panel p-[18px]">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-accent/12 text-accent">
          <Sparkles className="size-4.5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-semibold">{t("title")}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{t("body")}</p>
        </div>
      </div>

      {!proposal && (
        <>
          <label className="flex flex-col gap-1.5">
            <SectionLabel>{t("request").toUpperCase()}</SectionLabel>
            <textarea
              value={request}
              rows={3}
              maxLength={2000}
              placeholder={t("requestPlaceholder")}
              onChange={(e) => setRequest(e.target.value)}
              disabled={p.busy}
              className={cn(field, "resize-y py-2")}
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <SectionLabel>{t("folder").toUpperCase()}</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={t("folderPlaceholder")}
                aria-label={t("folder")}
                disabled={p.busy}
                className={cn(field, "h-[34px] min-w-0 grow basis-[240px] font-mono text-[12.5px]")}
              />
              <ChooseFolderButton onPick={setPath} lookOnly />
            </div>
            <span className="text-[12.5px] text-muted">{t("folderHint")}</span>
          </div>
          {p.busy ? (
            <Working onCancel={p.cancel} />
          ) : (
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => ask(false)} disabled={request.trim().length < 3}>
                <Sparkles className="size-3.5" aria-hidden="true" />
                {t("propose")}
              </Button>
            </div>
          )}
        </>
      )}

      {proposal && (
        <>
          <DraftEditor proposal={proposal} onChange={(draft) => setProposal({ ...proposal, draft })} disabled={p.busy || saving} />
          {p.busy ? (
            <Working onCancel={p.cancel} />
          ) : (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3.5">
              <input
                value={change}
                onChange={(e) => setChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void ask(true)}
                placeholder={t("changePlaceholder")}
                aria-label={t("changePlaceholder")}
                className={cn(field, "h-[34px] min-w-0 grow basis-[260px]")}
              />
              <Button onClick={() => ask(true)}>{t("again")}</Button>
              <Button variant="ghost" onClick={() => setProposal(null)}>
                {t("discard")}
              </Button>
              <Button variant="primary" onClick={create} disabled={saving}>
                {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
                {t("create")}
              </Button>
            </div>
          )}
        </>
      )}
      {p.error && <p className="text-xs text-danger">{p.error}</p>}
    </section>
  );
}

/** "Adjust with AI" on one of your teams: ask for a change in words, review it, apply it. */
export function AiTeamAdjust({ team }: { team: Team }) {
  const t = useTranslations("teams.ai");
  const locale = useLocale() as Locale;
  const { refreshTeams, refreshCrews, refreshWorkspaces } = useAppState();
  const [request, setRequest] = useState("");
  const [proposal, setProposal] = useState<{ draft: TeamDraft; summary: string; costUsd: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const p = useProposal();

  async function ask() {
    const result = await p.propose({ request: request.trim(), teamId: team.id, locale });
    if (result) setProposal(result);
  }

  async function apply() {
    if (!proposal) return;
    setSaving(true);
    p.setError(null);
    try {
      await api.applyTeamDraft(team.id, proposal.draft);
      await Promise.all([refreshTeams(), refreshCrews(), refreshWorkspaces()]);
      setProposal(null);
      setRequest("");
    } catch (err) {
      p.setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={cn("flex flex-col gap-3 rounded-2xl border bg-panel p-[18px]", proposal ? "border-accent/35" : "border-border")}>
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-accent" aria-hidden="true" />
        <h2 className="text-[14px] font-semibold">{t("adjustTitle")}</h2>
      </div>
      {!proposal && (p.busy ? (
        <Working onCancel={p.cancel} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <input
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && request.trim().length >= 3 && void ask()}
            placeholder={t("adjustPlaceholder")}
            aria-label={t("adjustTitle")}
            className={cn(field, "h-[34px] min-w-0 grow basis-[300px]")}
          />
          <Button onClick={ask} disabled={request.trim().length < 3}>
            {t("adjustPropose")}
          </Button>
        </div>
      ))}
      {proposal && (
        <>
          <DraftEditor proposal={proposal} base={team} onChange={(draft) => setProposal({ ...proposal, draft })} disabled={saving} />
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3.5">
            <Button variant="ghost" onClick={() => setProposal(null)} disabled={saving}>
              {t("discard")}
            </Button>
            <Button variant="primary" onClick={apply} disabled={saving}>
              {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              {t("apply")}
            </Button>
          </div>
        </>
      )}
      {p.error && <p className="text-xs text-danger">{p.error}</p>}
    </section>
  );
}

/** A proposal you can edit before saving. With `base` (a team being changed), it marks what is new, changed or leaving. */
function DraftEditor({
  proposal,
  base,
  onChange,
  disabled,
}: {
  proposal: { draft: TeamDraft; summary: string; costUsd: number | null };
  base?: Team;
  onChange: (draft: TeamDraft) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("teams.ai");
  const tt = useTranslations("teams");
  const locale = useLocale();
  const flowName = useFlowName();
  const { flows } = useAppState();
  const { draft } = proposal;
  const set = (patch: Partial<TeamDraft>) => onChange({ ...draft, ...patch });
  const setMember = (i: number, patch: Partial<TeamDraftMember>) => set({ members: draft.members.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const leaving = base ? base.members.filter((m) => !draft.members.some((x) => x.id === m.id)) : [];
  const planningFlows = flows.filter((f) => f.id === LEAD_DECIDES_ID || f.id === BUILD_AND_REVIEW_ID);
  const builders = draft.members.filter((m) => m.role === "builder").length;
  const reviewers = draft.members.filter((m) => m.role === "reviewer").length;

  function addMember() {
    const n = draft.members.length + 1;
    set({ members: [...draft.members, { id: `new-${n}-${Date.now().toString(36)}`, name: "", role: "reviewer", provider: draft.members[0]?.provider ?? "claude-code", personality: "balanced", instructions: "" }] });
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="rounded-xl border border-border bg-bg px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <Sparkles className="size-3.5 text-accent" aria-hidden="true" />
          {t(base ? "changesTitle" : "proposalTitle")}
          {proposal.costUsd !== null && <span className="ml-auto font-mono">{formatCost(proposal.costUsd, locale)}</span>}
        </div>
        {proposal.summary && <p className="mt-1 text-[13.5px]">{proposal.summary}</p>}
      </div>

      <fieldset disabled={disabled} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <label className="flex flex-col gap-1.5">
            <SectionLabel>{tt("name").toUpperCase()}</SectionLabel>
            <input value={draft.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} className={cn(field, "h-[34px]")} />
          </label>
          <label className="flex flex-col gap-1.5">
            <SectionLabel>{tt("description").toUpperCase()}</SectionLabel>
            <input value={draft.description} maxLength={200} onChange={(e) => set({ description: e.target.value })} className={cn(field, "h-[34px]")} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <SectionLabel>{tt("kind").toUpperCase()}</SectionLabel>
            <select value={draft.kind} onChange={(e) => set({ kind: e.target.value as WorkKind })} className={cn(field, "h-[34px] bg-panel-2")}>
              {WORK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {tt(`kinds.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <SectionLabel>{tt("planning").toUpperCase()}</SectionLabel>
            <select value={draft.planning} onChange={(e) => set({ planning: e.target.value })} className={cn(field, "h-[34px] bg-panel-2")}>
              {planningFlows.map((f) => (
                <option key={f.id} value={f.id}>
                  {flowName(f)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <SectionLabel>{tt("commands").toUpperCase()}</SectionLabel>
            <select value={draft.commands} onChange={(e) => set({ commands: e.target.value as TeamDraft["commands"] })} className={cn(field, "h-[34px] bg-panel-2")}>
              <option value="restricted">{tt("cmdRestricted")}</option>
              <option value="standard">{tt("cmdStandard")}</option>
            </select>
          </label>
        </div>
        {draft.planning === BUILD_AND_REVIEW_ID && (builders !== 1 || reviewers !== 1) && <p className="text-[12.5px] text-warning">{t("bnrHint")}</p>}
        {draft.commands === "standard" && draft.kind !== "code" && <p className="text-[12.5px] text-warning">{t("cmdWarn")}</p>}
        <label className="flex flex-col gap-1.5">
          <SectionLabel>{tt("about").toUpperCase()}</SectionLabel>
          <textarea value={draft.about} rows={2} maxLength={1000} onChange={(e) => set({ about: e.target.value })} className={cn(field, "resize-y py-2")} />
        </label>

        <SectionLabel>{t("members", { count: draft.members.length, max: MAX_DRAFT_MEMBERS }).toUpperCase()}</SectionLabel>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5">
          {draft.members.map((m, i) => (
            <DraftMember key={m.id} member={m} status={memberStatus(m, base)} onChange={(patch) => setMember(i, patch)} onRemove={() => set({ members: draft.members.filter((_, j) => j !== i) })} />
          ))}
          {draft.members.length < MAX_DRAFT_MEMBERS && (
            <button
              type="button"
              onClick={addMember}
              className="flex min-h-[120px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-[13px] text-muted hover:border-border-strong hover:text-text"
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("addMember")}
            </button>
          )}
        </div>
        {leaving.length > 0 && <p className="text-[12.5px] text-danger">{t("leaving", { names: leaving.map((m) => m.name).join(", ") })}</p>}
      </fieldset>
    </div>
  );
}

function memberStatus(m: TeamDraftMember, base?: Team): "new" | "changed" | null {
  if (!base) return null;
  const before = base.members.find((x) => x.id === m.id);
  if (!before) return "new";
  return before.name !== m.name || before.role !== m.role || before.personality !== m.personality || before.instructions !== m.instructions || before.provider !== m.provider
    ? "changed"
    : null;
}

function DraftMember({
  member,
  status,
  onChange,
  onRemove,
}: {
  member: TeamDraftMember;
  status: "new" | "changed" | null;
  onChange: (patch: Partial<TeamDraftMember>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("teams.ai");
  const tc = useTranslations("crew");
  const { providers } = useAppState();
  const lead = member.role === "lead";
  return (
    <article className={cn("flex flex-col gap-2 rounded-xl border bg-bg p-3", status === "new" ? "border-success/40" : status === "changed" ? "border-info/40" : "border-border")}>
      <div className="flex items-center gap-2">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg bg-glyph text-[12px] font-bold", actorColor(member.id, member.role))}>
          {(member.name[0] ?? "?").toUpperCase()}
        </span>
        <input
          value={member.name}
          maxLength={24}
          placeholder={tc("namePlaceholder")}
          aria-label={tc("name")}
          onChange={(e) => onChange({ name: e.target.value })}
          className="min-w-0 grow rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[14px] font-semibold outline-none hover:border-border focus:border-border-strong"
        />
        {status && <Chip tone={status === "new" ? "success" : "info"} className="h-5">{t(status === "new" ? "badgeNew" : "badgeChanged")}</Chip>}
        <button type="button" onClick={onRemove} aria-label={t("remove", { name: member.name || "?" })} className="text-muted hover:text-danger">
          {lead ? <X className="size-3.5" aria-hidden="true" /> : <Trash2 className="size-3.5" aria-hidden="true" />}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          value={member.role}
          disabled={lead}
          aria-label={tc("role")}
          onChange={(e) => onChange({ role: e.target.value as TeamDraftMember["role"] })}
          className="h-7 rounded-md border border-border bg-panel-2 px-1.5 text-[12px] outline-none"
        >
          {lead ? <option value="lead">Lead</option> : null}
          <option value="builder">{tc("builder")}</option>
          <option value="reviewer">{tc("reviewer")}</option>
        </select>
        <select
          value={member.personality}
          aria-label={tc("personality")}
          onChange={(e) => onChange({ personality: e.target.value as Personality })}
          className="h-7 rounded-md border border-border bg-panel-2 px-1.5 text-[12px] outline-none"
        >
          {PERSONALITIES.map((p) => (
            <option key={p} value={p}>
              {tc(p)}
            </option>
          ))}
        </select>
        <select
          value={member.provider}
          aria-label={tc("runsOn")}
          onChange={(e) => onChange({ provider: e.target.value as ProviderId })}
          className="col-span-2 h-7 rounded-md border border-border bg-panel-2 px-1.5 text-[12px] outline-none"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.available}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={member.instructions}
        rows={3}
        maxLength={2000}
        aria-label={tc("instructions")}
        placeholder={member.role === "builder" ? tc("builderPlaceholder") : tc("reviewerPlaceholder")}
        onChange={(e) => onChange({ instructions: e.target.value })}
        className="resize-y rounded-md border border-border bg-panel px-2 py-1.5 text-[12.5px] outline-none focus:border-border-strong"
      />
      {member.why && <p className="text-[12px] text-muted">{member.why}</p>}
    </article>
  );
}
