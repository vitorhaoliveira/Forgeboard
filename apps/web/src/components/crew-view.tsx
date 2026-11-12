"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { MAX_AGENTS, TEAM_TEMPLATES, WORK_KINDS, type Agent, type AgentRole, type ForgeCommands, type Locale, type Personality, type ProviderId, type Team, type WorkKind } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { useFlowName } from "./flow-graph";
import { actorColor, Glyph } from "./glyph";
import { RulesEditor } from "./rules-editor";
import { AiTeamAdjust, AiTeamBuilder } from "./team-builder";
import { Button, Chip, SectionLabel } from "./ui";

const PERSONALITIES: Personality[] = ["mentor", "balanced", "strict"];
/** Roles of agents you create; the Lead is built in. */
const ROLES: Exclude<AgentRole, "lead">[] = ["builder", "reviewer"];

/** Edits one agent: the default team's, a workspace's own (workspaceId), or a team's (teamId). */
export function AgentCard({ agent, workspaceId, teamId }: { agent: Agent; workspaceId?: string; teamId?: string }) {
  const t = useTranslations("crew");
  const tc = useTranslations("common");
  const tws = useTranslations("wsSettings");
  const { providers, refreshCrews, refreshWorkspaces, refreshTeams, teams } = useAppState();
  // In a team whose builders only edit files, say so.
  const filesOnly = teamId ? teams.find((x) => x.id === teamId)?.commands === "restricted" : false;
  const [draft, setDraft] = useState(agent);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty =
    draft.name !== agent.name || draft.provider !== agent.provider || draft.personality !== agent.personality || draft.instructions !== agent.instructions;

  useEffect(() => setDraft(agent), [agent]);

  async function run(action: () => Promise<unknown>) {
    setState("saving");
    setError(null);
    try {
      await action();
      await Promise.all([refreshCrews(), refreshWorkspaces(), refreshTeams()]);
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  }

  const save = () => {
    const data = { name: draft.name, provider: draft.provider, personality: draft.personality, instructions: draft.instructions };
    return run(() => (teamId ? api.updateTeamAgent(teamId, agent.id, data) : api.updateAgent(agent.id, data, workspaceId)));
  };
  const reset = () => run(() => api.resetAgent(agent.id, workspaceId!));
  const remove = () => run(() => (teamId ? api.removeTeamAgent(teamId, agent.id) : api.removeAgent(agent.id, workspaceId)));

  const id = `agent-${teamId ?? workspaceId ?? "default"}-${agent.id}`;
  return (
    <article className={cn("flex flex-col gap-4 rounded-2xl border border-border bg-panel p-[18px]", agent.role === "reviewer" && "border-info/25")}>
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
          <div className="px-1 text-[12.5px] text-muted">{agent.role === "builder" ? (filesOnly ? t("roleMaker") : t("roleBuilder")) : agent.role === "lead" ? t("roleLead") : t("roleReviewer")}</div>
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
        {!agent.builtIn &&
          (confirmDelete ? (
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={state === "saving"}>
                {tc("cancel")}
              </Button>
              <Button variant="danger" onClick={remove} disabled={state === "saving"}>
                {t("confirmDelete", { name: agent.name })}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={state === "saving"} className="mr-auto">
              <Trash2 className="size-3.5" aria-hidden="true" />
              {tc("delete")}
            </Button>
          ))}
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

/** Creates an agent with a role: in the default crew, or in a workspace's own crew. */
export function NewAgentCard({ workspaceId, teamId, count }: { workspaceId?: string; teamId?: string; count: number }) {
  const t = useTranslations("crew");
  const tc = useTranslations("common");
  const { providers, refreshCrews, refreshWorkspaces, refreshTeams } = useAppState();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Exclude<AgentRole, "lead">>("builder");
  const [personality, setPersonality] = useState<Personality>("balanced");
  const [provider, setProvider] = useState<ProviderId>("claude-code");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = count >= MAX_AGENTS;

  function close() {
    setOpen(false);
    setName("");
    setRole("builder");
    setPersonality("balanced");
    setInstructions("");
    setError(null);
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const input = { name: name.trim(), role, personality, provider, instructions };
      await (teamId ? api.createTeamAgent(teamId, input) : api.createAgent(input, workspaceId));
      await Promise.all([refreshCrews(), refreshWorkspaces(), refreshTeams()]);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={full}
        className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-[18px] text-muted transition hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="size-5" aria-hidden="true" />
        <span className="text-sm font-medium">{t("newAgent")}</span>
        <span className="max-w-[240px] text-center text-[12.5px]">{full ? t("crewFull", { max: MAX_AGENTS }) : t("newAgentHint")}</span>
      </button>
    );
  }

  const id = `new-agent-${teamId ?? workspaceId ?? "default"}`;
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-border-strong bg-panel p-[18px]">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-name`}>
          <SectionLabel>{t("name").toUpperCase()}</SectionLabel>
        </label>
        <input
          id={`${id}-name`}
          autoFocus
          value={name}
          maxLength={24}
          placeholder={t("namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
          className="h-[34px] rounded-lg border border-border bg-bg px-2.5 text-[13px] outline-none focus:border-border-strong"
        />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("role").toUpperCase()}</SectionLabel>
        <div role="radiogroup" aria-label={t("role")} className="grid grid-cols-2 gap-2">
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left",
                role === r ? "border-border-strong bg-panel-2" : "border-border text-muted hover:text-text",
              )}
            >
              <span className="text-[13px] font-medium">{t(r)}</span>
              <span className="text-[12px] text-muted">{t(`${r}Hint`)}</span>
            </button>
          ))}
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
              aria-checked={personality === p}
              onClick={() => setPersonality(p)}
              className={cn("h-7 rounded-md", personality === p ? "bg-panel-2 shadow-[inset_0_0_0_1px_var(--border)]" : "text-muted hover:text-text")}
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
          value={provider}
          onChange={(e) => setProvider(e.target.value as ProviderId)}
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
          value={instructions}
          placeholder={role === "builder" ? t("builderPlaceholder") : t("reviewerPlaceholder")}
          onChange={(e) => setInstructions(e.target.value)}
          className="resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13px] outline-none focus:border-border-strong"
        />
      </div>

      <p className="text-[12.5px] text-muted">{t("newAgentFlows")}</p>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={close} disabled={busy}>
          {tc("cancel")}
        </Button>
        <Button variant="primary" onClick={create} disabled={busy || !name.trim()}>
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {t("create")}
        </Button>
      </div>
    </article>
  );
}

/** A template member: letter in its role color, with its name. */
function MemberChip({ id, name, role }: { id: string; name: string; role: AgentRole }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-panel-2 pr-2.5 pl-1 text-xs">
      <span className={cn("grid size-5 place-items-center rounded-md bg-glyph text-[11px] font-bold", actorColor(id, role))}>{name[0]}</span>
      {name}
    </span>
  );
}

/** Ready-made teams: picking one makes your own copy. */
function TemplateGallery({ onCreated }: { onCreated: (teamId: string) => void }) {
  const t = useTranslations("teams");
  const locale = useLocale() as Locale;
  const flowName = useFlowName();
  const { flows, refreshTeams } = useAppState();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(templateId?: string, name?: string, description?: string) {
    setBusy(templateId ?? "blank");
    setError(null);
    try {
      const team = await api.createTeam({ name: name ?? t("blankName"), description, templateId, locale });
      await refreshTeams();
      onCreated(team.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <AiTeamBuilder onCreated={onCreated} />
      <div className="mt-2">
        <h2 className="text-base font-semibold">{t("templatesTitle")}</h2>
        <p className="mt-1 text-[13px] text-muted">{t("templatesBody")}</p>
      </div>
      {(["code", "other"] as const).map((group) => (
      <div key={group} className="flex flex-col gap-2.5">
      <SectionLabel>{t(group === "code" ? "forCode" : "forOther").toUpperCase()}</SectionLabel>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5">
        {TEAM_TEMPLATES.filter((tpl) => (tpl.kind === "code") === (group === "code")).map((tpl) => {
          const flow = flows.find((f) => f.id === tpl.planning);
          return (
            <article key={tpl.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-panel p-[18px]">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[15px] font-semibold">{tpl.name[locale]}</h3>
                  {tpl.kind !== "code" && <Chip className="ml-auto h-5">{t(`kinds.${tpl.kind}`)}</Chip>}
                </div>
                <p className="mt-1 text-[13px] text-muted">{tpl.description[locale]}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tpl.members.map((m) => (
                  <MemberChip key={m.id} id={m.id} name={m.name} role={m.role} />
                ))}
              </div>
              {flow && <p className="text-[12.5px] text-muted">{t("runs", { flow: flowName(flow) })}</p>}
              <ul className="flex flex-col gap-0.5 text-[12.5px] text-muted">
                {tpl.examples[locale].map((ex) => (
                  <li key={ex}>“{ex}”</li>
                ))}
              </ul>
              <div className="mt-auto flex justify-end">
                <Button variant="primary" onClick={() => create(tpl.id, tpl.name[locale], tpl.description[locale])} disabled={busy !== null}>
                  {busy === tpl.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
                  {t("useTemplate")}
                </Button>
              </div>
            </article>
          );
        })}
        {group === "other" && (
        <article className="flex flex-col gap-3 rounded-2xl border border-dashed border-border p-[18px]">
          <div>
            <h3 className="text-[15px] font-semibold">{t("blankTitle")}</h3>
            <p className="mt-1 text-[13px] text-muted">{t("blankBody")}</p>
          </div>
          <div className="mt-auto flex justify-end">
            <Button onClick={() => create()} disabled={busy !== null}>
              {busy === "blank" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
              {t("blankCreate")}
            </Button>
          </div>
        </article>
        )}
      </div>
      </div>
      ))}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** One of your teams: name, what it runs by default, its members. */
function TeamEditor({ team, onDeleted }: { team: Team; onDeleted: () => void }) {
  const t = useTranslations("teams");
  const tc = useTranslations("common");
  const flowName = useFlowName();
  const { flows, workspaces, refreshTeams, refreshWorkspaces, refreshCrews } = useAppState();
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description);
  const [planning, setPlanning] = useState(team.planning);
  const [kind, setKind] = useState<WorkKind>(team.kind ?? "code");
  const [about, setAbout] = useState(team.about ?? "");
  const [commands, setCommands] = useState<ForgeCommands>(team.commands ?? "standard");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(team.name);
    setDescription(team.description);
    setPlanning(team.planning);
    setKind(team.kind ?? "code");
    setAbout(team.about ?? "");
    setCommands(team.commands ?? "standard");
  }, [team]);
  const dirty =
    name !== team.name ||
    description !== team.description ||
    planning !== team.planning ||
    kind !== (team.kind ?? "code") ||
    about !== (team.about ?? "") ||
    commands !== (team.commands ?? "standard");
  const usedBy = workspaces.filter((w) => w.crewMode === "team" && w.teamId === team.id);

  async function save() {
    setState("saving");
    setError(null);
    try {
      await api.updateTeam(team.id, { name: name.trim(), description: description.trim(), planning, kind, about: about.trim(), commands });
      await refreshTeams();
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  }

  async function remove() {
    try {
      await api.removeTeam(team.id);
      await Promise.all([refreshTeams(), refreshWorkspaces(), refreshCrews()]);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <AiTeamAdjust team={team} />
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-panel p-[18px]">
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <label className="flex flex-col gap-1.5">
            <SectionLabel>{t("name").toUpperCase()}</SectionLabel>
            <input
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              className="h-[34px] rounded-lg border border-border bg-bg px-2.5 text-[13px] outline-none focus:border-border-strong"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <SectionLabel>{t("description").toUpperCase()}</SectionLabel>
            <input
              value={description}
              maxLength={200}
              onChange={(e) => setDescription(e.target.value)}
              className="h-[34px] rounded-lg border border-border bg-bg px-2.5 text-[13px] outline-none focus:border-border-strong"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <SectionLabel>{t("planning").toUpperCase()}</SectionLabel>
          <select
            value={planning}
            onChange={(e) => setPlanning(e.target.value)}
            className="h-[34px] max-w-sm rounded-lg border border-border bg-panel-2 px-2.5 text-[13px] outline-none"
          >
            {flows.map((f) => (
              <option key={f.id} value={f.id}>
                {flowName(f)}
              </option>
            ))}
          </select>
          <span className="text-[12.5px] text-muted">{t("planningHint")}</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <label className="flex flex-col gap-1.5">
            <SectionLabel>{t("kind").toUpperCase()}</SectionLabel>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as WorkKind)}
              className="h-[34px] rounded-lg border border-border bg-panel-2 px-2.5 text-[13px] outline-none"
            >
              {WORK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </select>
            <span className="text-[12.5px] text-muted">{t("kindHint")}</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <SectionLabel>{t("about").toUpperCase()}</SectionLabel>
            <textarea
              value={about}
              maxLength={1000}
              rows={2}
              placeholder={t("aboutPlaceholder")}
              onChange={(e) => setAbout(e.target.value)}
              className="resize-y rounded-lg border border-border bg-bg px-2.5 py-2 text-[13px] outline-none focus:border-border-strong"
            />
            <span className="text-[12.5px] text-muted">{t("aboutHint")}</span>
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <SectionLabel>{t("commands").toUpperCase()}</SectionLabel>
          <div role="radiogroup" aria-label={t("commands")} className="grid gap-2 sm:grid-cols-2">
            {(["restricted", "standard"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={commands === c}
                onClick={() => setCommands(c)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left",
                  commands === c ? "border-border-strong bg-panel-2" : "border-border text-muted hover:text-text",
                )}
              >
                <span className="text-[13px] font-medium">{t(c === "standard" ? "cmdStandard" : "cmdRestricted")}</span>
                <span className="text-[12px] text-muted">{t(c === "standard" ? "cmdStandardHint" : "cmdRestrictedHint")}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="text-[12.5px] text-muted">
          {usedBy.length ? t("usedBy", { names: usedBy.map((w) => w.name).join(", ") }) : t("unused")}
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {confirm ? (
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)} className="mr-auto">
                {tc("cancel")}
              </Button>
              <Button variant="danger" onClick={remove}>
                {t("confirmDelete")}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirm(true)} className="mr-auto hover:text-danger">
              <Trash2 className="size-3.5" aria-hidden="true" />
              {t("delete")}
            </Button>
          )}
          <Button variant="primary" onClick={save} disabled={!dirty || !name.trim() || state === "saving"}>
            {state === "saving" && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            {state === "saved" && <Check className="size-3.5" aria-hidden="true" />}
            {state === "saved" ? tc("saved") : tc("save")}
          </Button>
        </div>
      </section>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5">
        {agentsOfTeam(team).map((a) => (
          <AgentCard key={a.id} agent={a} teamId={team.id} />
        ))}
        <NewAgentCard teamId={team.id} count={team.members.length} />
      </div>
    </div>
  );
}

/** A team's members as the UI shows them: any can be removed, Forge, Hawk and Lead keep their role. */
function agentsOfTeam(team: Team): Agent[] {
  return team.members.map((m) => ({ ...m, builtIn: false, customized: false }));
}

/** Teams: the default team, your teams and ready-made templates. The general house rules sit beside them. */
export function CrewView() {
  const t = useTranslations("crew");
  const tt = useTranslations("teams");
  const { crews, teams } = useAppState();
  // "default", a team id, or "new" (the template gallery).
  const [tab, setTab] = useState<string>("default");
  useEffect(() => {
    const team = new URLSearchParams(window.location.search).get("team");
    if (team) setTab(team);
  }, []);
  const team = teams.find((x) => x.id === tab);
  const current = tab === "new" || tab === "default" || team ? tab : "default";

  const tabClass = (on: boolean) =>
    cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px]", on ? "border-border-strong bg-panel-2 text-text" : "border-transparent text-muted hover:text-text");

  return (
    <div className="flex grow flex-wrap">
      <main className="flex min-w-0 grow-[999] basis-[600px] flex-col gap-5 px-[30px] py-[26px]">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{tt("title")}</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-muted">{tt("subtitle")}</p>
        </div>
        <nav aria-label={tt("title")} className="flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={current === "default"} onClick={() => setTab("default")} className={tabClass(current === "default")}>
            {t("title")}
          </button>
          {teams.map((x) => (
            <button key={x.id} type="button" aria-pressed={current === x.id} onClick={() => setTab(x.id)} className={tabClass(current === x.id)}>
              {x.name}
            </button>
          ))}
          <button type="button" aria-pressed={current === "new"} onClick={() => setTab("new")} className={tabClass(current === "new")}>
            <Plus className="size-3.5" aria-hidden="true" />
            {tt("newTeam")}
          </button>
        </nav>

        {current === "default" && (
          <>
            <p className="max-w-2xl text-[13px] text-muted">{t("subtitle")}</p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5">
              {(crews.default ?? []).map((a) => (
                <AgentCard key={a.id} agent={a} />
              ))}
              <NewAgentCard count={(crews.default ?? []).length} />
            </div>
          </>
        )}
        {current === "new" && <TemplateGallery onCreated={(id) => setTab(id)} />}
        {team && <TeamEditor key={team.id} team={team} onDeleted={() => setTab("default")} />}
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
