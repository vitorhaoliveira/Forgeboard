// Builds the `forgeboard` npm package into packages/cli/dist:
//   dist/cli.js  the command, with the API server bundled in
//   dist/web/    the Next.js standalone build, with the few packages it needs at runtime
import { execSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, "..");
const root = join(pkgDir, "../..");
const webDir = join(root, "apps/web");
const dist = join(pkgDir, "dist");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

console.log("› Building the web app (standalone)…");
execSync("pnpm --filter @forgeboard/web build", {
  cwd: root,
  stdio: "inherit",
  // An empty API URL makes the browser call /api on the same origin.
  env: { ...process.env, FORGEBOARD_STANDALONE: "1", NEXT_PUBLIC_FORGEBOARD_API: "", NEXT_PUBLIC_FORGEBOARD_DEMO: "" },
});

console.log("› Copying the web build…");
rmSync(dist, { recursive: true, force: true });
const standalone = join(webDir, ".next/standalone/apps/web");
cpSync(standalone, join(dist, "web"), {
  recursive: true,
  filter: (src) => !src.split(/[\\/]/).includes("node_modules"),
});

// Next traced only what the server needs (next, react, react-dom…). pnpm stores them behind
// symlinks; copy each one into a plain node_modules so the package works anywhere.
// sharp is left out: it's only for next/image, which Forgeboard doesn't use.
const SKIP = new Set(["sharp", "@img"]);
const store = join(webDir, ".next/standalone/node_modules/.pnpm");
const modules = join(dist, "web/node_modules");
const copied = [];
for (const entry of readdirSync(store)) {
  const nm = join(store, entry, "node_modules");
  if (!existsSync(nm)) continue;
  for (const name of readdirSync(nm)) {
    if (SKIP.has(name) || name === ".bin") continue;
    const dirs = name.startsWith("@") ? readdirSync(join(nm, name)).map((n) => `${name}/${n}`) : [name];
    for (const dir of dirs) {
      const src = join(nm, dir);
      if (lstatSync(src).isSymbolicLink() || existsSync(join(modules, dir))) continue;
      cpSync(src, join(modules, dir), { recursive: true, dereference: true });
      copied.push(dir);
    }
  }
}
console.log(`  runtime packages: ${copied.sort().join(", ")}`);
cpSync(join(webDir, ".next/static"), join(dist, "web/.next/static"), { recursive: true });
if (existsSync(join(webDir, "public"))) cpSync(join(webDir, "public"), join(dist, "web/public"), { recursive: true });

console.log("› Bundling the command and the API server…");
await build({
  entryPoints: [join(pkgDir, "src/cli.ts")],
  outfile: join(dist, "forgeboard.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: false,
  legalComments: "none",
  define: { __VERSION__: JSON.stringify(pkg.version) },
  banner: {
    // Some bundled dependencies still call require().
    js: "import { createRequire as __fbCreateRequire } from 'node:module';\nconst require = __fbCreateRequire(import.meta.url);",
  },
});

// The entry point hides node:sqlite's ExperimentalWarning before anything imports it.
writeFileSync(
  join(dist, "cli.js"),
  `#!/usr/bin/env node
const emit = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === "string" ? warning : warning?.message ?? "";
  if (text.includes("SQLite")) return;
  emit(warning, ...rest);
};
await import("./forgeboard.js");
`,
  { mode: 0o755 },
);
// npm picks up the license from the package folder.
cpSync(join(root, "LICENSE"), join(pkgDir, "LICENSE"));
writeFileSync(join(dist, ".build"), `${pkg.version} ${new Date().toISOString()}\n`);
console.log(`✓ forgeboard@${pkg.version} built in packages/cli/dist`);
