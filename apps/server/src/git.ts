import { execFile } from "node:child_process";
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DiffFile } from "@forgeboard/shared";

const execFileAsync = promisify(execFile);

/** Paths never staged: the node_modules symlink we add to worktrees. */
const EXCLUDE = [":(exclude)node_modules"];

export class GitError extends Error {}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 50 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new GitError((e.stderr || e.message).trim());
  }
}

export async function repoRoot(path: string): Promise<string | null> {
  try {
    return (await git(path, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    return null;
  }
}

export async function currentBranch(repoPath: string): Promise<string> {
  const branch = (await git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  if (branch === "HEAD") throw new GitError("The repository is in detached HEAD state. Check out a branch first.");
  return branch;
}

export async function headSha(repoPath: string): Promise<string> {
  try {
    return (await git(repoPath, ["rev-parse", "HEAD"])).trim();
  } catch {
    throw new GitError("The repository has no commits yet. Make a first commit, then try again.");
  }
}

export async function createWorktree(repoPath: string, branch: string, dir: string, baseSha: string): Promise<void> {
  await git(repoPath, ["worktree", "add", "-b", branch, dir, baseSha]);
  // A fresh worktree has no dependencies installed. Reuse the repo's so checks can run.
  const modules = join(repoPath, "node_modules");
  if (existsSync(modules) && !existsSync(join(dir, "node_modules"))) {
    symlinkSync(modules, join(dir, "node_modules"), "dir");
  }
}

async function stageAll(worktree: string): Promise<void> {
  await git(worktree, ["add", "-A", "--", ".", ...EXCLUDE]);
}

function parseStatus(header: string, body: string): DiffFile["status"] {
  if (/^new file mode/m.test(body)) return "added";
  if (/^deleted file mode/m.test(body)) return "deleted";
  if (/^rename from/m.test(body)) return "renamed";
  void header;
  return "modified";
}

/** Everything the agents changed in the worktree, compared to where the task started. */
export async function diff(worktree: string, baseSha: string): Promise<DiffFile[]> {
  await stageAll(worktree);
  const patch = await git(worktree, ["diff", "--cached", "-M", "--no-color", baseSha]);
  const chunks = patch.split(/^(?=diff --git )/m).filter((c) => c.startsWith("diff --git"));
  return chunks.map((chunk) => {
    const header = chunk.split("\n", 1)[0] ?? "";
    const plusPath = /^\+\+\+ b\/(.+)$/m.exec(chunk)?.[1];
    const minusPath = /^--- a\/(.+)$/m.exec(chunk)?.[1];
    const headerPath = / b\/(.+)$/.exec(header)?.[1];
    const path = plusPath ?? headerPath ?? minusPath ?? "unknown";
    let additions = 0;
    let deletions = 0;
    for (const line of chunk.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
    return { path, status: parseStatus(header, chunk), additions, deletions, patch: chunk };
  });
}

/** Puts the given files back to how they were at baseSha, dropping the agents' changes to them. */
export async function restoreFiles(worktree: string, baseSha: string, files: string[]): Promise<void> {
  await stageAll(worktree);
  for (const file of files) {
    const existedBefore = await git(worktree, ["cat-file", "-e", `${baseSha}:${file}`]).then(
      () => true,
      () => false,
    );
    if (existedBefore) {
      await git(worktree, ["checkout", baseSha, "--", file]);
    } else {
      await git(worktree, ["rm", "-f", "--cached", "--", file]).catch(() => undefined);
      rmSync(join(worktree, file), { force: true });
    }
  }
}

export async function commit(worktree: string, message: string): Promise<void> {
  await stageAll(worktree);
  const staged = (await git(worktree, ["diff", "--cached", "--name-only"])).trim();
  if (!staged) throw new GitError("There are no changes left to merge.");
  await git(worktree, ["commit", "-m", message]);
}

export async function merge(repoPath: string, branch: string, baseBranch: string): Promise<void> {
  const current = await currentBranch(repoPath);
  if (current !== baseBranch) {
    throw new GitError(
      `Your repository is on "${current}", but this task started from "${baseBranch}". Check out "${baseBranch}" and try again.`,
    );
  }
  await git(repoPath, ["merge", "--no-ff", "--no-edit", branch]);
}

export async function removeWorktree(repoPath: string, worktree: string): Promise<void> {
  await git(repoPath, ["worktree", "remove", "--force", worktree]).catch(() => {
    rmSync(worktree, { recursive: true, force: true });
    return git(repoPath, ["worktree", "prune"]);
  });
}

export async function deleteBranch(repoPath: string, branch: string): Promise<void> {
  await git(repoPath, ["branch", "-D", branch]).catch(() => undefined);
}
