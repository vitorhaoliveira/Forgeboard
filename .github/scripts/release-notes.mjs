// Prints the GitHub release title and notes for a tag, taken from CHANGELOG.md.
// Usage: node .github/scripts/release-notes.mjs v1.9.0 <title-file> <notes-file>
// Exits with an error if CHANGELOG.md has no section for the version.
import { readFileSync, writeFileSync } from "node:fs";

const [tag, titleFile, notesFile] = process.argv.slice(2);
const version = tag.replace(/^v/, "");
const lines = readFileSync("CHANGELOG.md", "utf8").split("\n");

const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`CHANGELOG.md has no "## [${version}]" section.`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
if (end === -1) end = lines.length;
const body = lines.slice(start + 1, end).join("\n").trim();

// Title: the section's first line up to ":" or the final ".",
// e.g. "Talk to the crew: a conversation…" → "v1.9.0 — Talk to the crew".
const summary = body.split("\n")[0].split(":")[0].replace(/\.$/, "").trim();
const title = summary && !summary.startsWith("#") ? `${tag} — ${summary}` : tag;

// The previous version is the next section down, for the compare link.
const prev = lines[end]?.match(/^## \[([^\]]+)\]/)?.[1];
const compare = prev
  ? `\n\n**Full changelog:** https://github.com/${process.env.GITHUB_REPOSITORY ?? "vitorhaoliveira/Forgeboard"}/compare/v${prev}...${tag}`
  : "";

writeFileSync(titleFile, title);
writeFileSync(notesFile, body + compare + "\n");
