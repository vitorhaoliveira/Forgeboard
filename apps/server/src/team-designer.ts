import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeTeamDraft, type ProposeTeamInput, type ProviderId, type Team, type TeamProposal } from "@forgeboard/shared";
import { agents } from "./db.js";
import { parseTeamLine, teamDesignPrompt } from "./prompts.js";
import { getProvider, listProviders } from "./providers/index.js";

/** Tools a designer can't use: it only reads, like a reviewer. */
const READ_ONLY = ["Bash", "Edit", "Write", "NotebookEdit"];

export class DesignError extends Error {}

/**
 * Asks an agent to design a team (or change `team`) and returns its proposal, checked and ready to edit.
 * It runs on the default team's Lead provider, read only, in the folder when there is one.
 * Nothing is saved: you approve the proposal first.
 */
export async function proposeTeam(input: ProposeTeamInput, team: Team | undefined, signal: AbortSignal): Promise<TeamProposal> {
  const lead = (team?.members ?? []).find((m) => m.role === "lead") ?? agents.defaults().find((a) => a.role === "lead");
  const installed = (await listProviders()).filter((p) => p.available).map((p) => p.id);
  const provider: ProviderId = lead && installed.includes(lead.provider) ? lead.provider : (installed.find((p) => p !== "mock") ?? "mock");
  // The mock is offered only when it designs, so a real team never gets it by accident.
  const providers = installed.filter((p) => p !== "mock" || provider === "mock");

  if (input.path) {
    let dir = false;
    try {
      dir = statSync(input.path).isDirectory();
    } catch {
      // Missing: reported below.
    }
    if (!dir) throw new DesignError("That folder doesn't exist.");
  }
  // Without a folder it still needs a place to run: an empty one.
  const scratch = input.path ? null : mkdtempSync(join(tmpdir(), "forgeboard-team-"));
  try {
    const output = await getProvider(provider).run({
      role: "lead",
      prompt: teamDesignPrompt({
        request: input.request,
        ...(input.path ? { folder: input.path } : {}),
        ...(team
          ? {
              current: {
                name: team.name,
                description: team.description,
                kind: team.kind ?? "code",
                about: team.about ?? "",
                commands: team.commands ?? "standard",
                planning: team.planning,
                members: team.members.map((m) => ({ id: m.id, name: m.name, role: m.role, personality: m.personality, instructions: m.instructions })),
              },
            }
          : {}),
        ...(input.previous ? { previous: input.previous } : {}),
        providers,
        locale: input.locale,
      }),
      cwd: input.path ?? scratch!,
      permissionMode: "plan",
      disallowedTools: READ_ONLY,
      locale: input.locale,
      round: 0,
      signal,
      emit: () => {},
    });
    const line = parseTeamLine(output.text);
    // A team keeps its permission to run commands unless the proposal takes it away.
    const draft = line && normalizeTeamDraft(line.data, { provider, providers, ...(team ? { existing: team } : {}), allowCommands: team?.commands === "standard" });
    if (!line || !draft) {
      throw new DesignError(
        input.locale === "pt-BR" ? "A IA não devolveu um time que dê para usar. Tente de novo, talvez com mais detalhes." : "The AI didn't come back with a usable team. Try again, maybe with more detail.",
      );
    }
    return { draft, summary: line.summary, costUsd: output.costUsd };
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}
