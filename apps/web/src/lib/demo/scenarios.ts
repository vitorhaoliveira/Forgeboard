import type { AgentQuestion, CheckCommand, CheckResult, DiffFile, Locale, ReviewIssue, Verdict } from "@forgeboard/shared";

/** Picks the English or Portuguese text. */
export const tr = (locale: Locale, en: string, pt: string) => (locale === "pt-BR" ? pt : en);

export interface ToolStep {
  name: string;
  input: Record<string, unknown>;
  output: string;
  isError?: boolean;
}

/** Everything a scripted run needs to look like a real one. */
export interface ScenarioContent {
  explore: ToolStep[];
  question?: AgentQuestion;
  /** What Forge says before building. */
  plan: string;
  build: ToolStep[];
  summary: string;
  /** Results of the first checks run (later rounds pass). */
  firstChecks: CheckResult[];
  /** Hawk's issues in rounds that aren't approved. */
  issues: ReviewIssue[];
  fixIntro: string;
  fix: ToolStep[];
  fixSummary: string;
  approvedSummary: string;
  concernsSummary: string;
  suggestedRule?: string;
  /** Round in which Hawk approves; above maxRounds means it never does. */
  approveOnRound: number;
  diff: DiffFile[];
}

function patch(path: string, status: DiffFile["status"], hunk: string, lines: string[]): DiffFile {
  const body = lines.join("\n");
  const additions = lines.filter((l) => l.startsWith("+")).length;
  const deletions = lines.filter((l) => l.startsWith("-")).length;
  const header =
    status === "added"
      ? `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n`
      : `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`;
  return { path, status, additions, deletions, patch: `${header}${hunk}\n${body}\n` };
}

const check = (c: CheckCommand, ok: boolean, output: string, durationMs: number): CheckResult => ({ ...c, ok, output, durationMs });

export const WEB_CHECKS: CheckCommand[] = [
  { name: "types", command: "pnpm typecheck" },
  { name: "lint", command: "pnpm lint" },
  { name: "tests", command: "pnpm test" },
];
export const API_CHECKS: CheckCommand[] = [
  { name: "types", command: "pnpm typecheck" },
  { name: "tests", command: "pnpm test" },
];
export const SHOP_CHECKS: CheckCommand[] = [{ name: "tests", command: "npm test" }];
export const BLOG_CHECKS: CheckCommand[] = [{ name: "lint", command: "npm run lint" }];

export function paginationScenario(L: Locale): ScenarioContent {
  return {
    explore: [
      { name: "Glob", input: { pattern: "src/**/*Users*" }, output: "src/components/UsersTable.tsx\nsrc/app/api/users/route.ts" },
      { name: "Read", input: { file_path: "src/components/UsersTable.tsx" }, output: "export function UsersTable({ users }) {\n  return <table>…</table>;\n}" },
      { name: "Read", input: { file_path: "src/app/api/users/route.ts" }, output: "export async function GET() {\n  return Response.json(await db.user.findMany());\n}" },
    ],
    question: {
      question: tr(L, "When a filter changes, should the table jump back to page 1?", "Quando um filtro muda, a tabela deve voltar para a página 1?"),
      context: tr(
        L,
        "Keeping the page can show an empty result if the filtered list is shorter. Resetting is what OrdersTable does.",
        "Manter a página pode mostrar um resultado vazio se a lista filtrada for menor. Voltar para a página 1 é o que a OrdersTable faz.",
      ),
      options: [tr(L, "Yes, reset to page 1", "Sim, voltar para a página 1"), tr(L, "Keep the current page", "Manter a página atual")],
      suggested: 0,
    },
    plan: tr(L, "Got it. I'll add `page` and `pageSize` to the API, a `Pagination` component, and keep the page in the URL.", "Entendido. Vou adicionar `page` e `pageSize` na API, um componente `Pagination` e manter a página na URL."),
    build: [
      { name: "Edit", input: { file_path: "src/app/api/users/route.ts" }, output: "The file has been updated." },
      { name: "Write", input: { file_path: "src/components/Pagination.tsx" }, output: "File created." },
      { name: "Edit", input: { file_path: "src/components/UsersTable.tsx" }, output: "The file has been updated." },
      { name: "Bash", input: { command: "pnpm test UsersTable" }, output: "✓ renders the first page\n✓ resets to page 1 when filters change\n\nTests: 2 passed" },
    ],
    summary: tr(
      L,
      "Added `page`/`pageSize` to `GET /api/users`, a `Pagination` component and URL sync (`?page=2`). Filters reset the page, as you asked.",
      "Adicionei `page`/`pageSize` ao `GET /api/users`, um componente `Pagination` e sincronia com a URL (`?page=2`). Os filtros voltam para a página 1, como você pediu.",
    ),
    firstChecks: [
      check(WEB_CHECKS[0]!, false, "src/components/Pagination.tsx:9:7 - error TS2322: Type 'string | null' is not assignable to type 'number'.", 4210),
      check(WEB_CHECKS[1]!, true, "", 2380),
      check(WEB_CHECKS[2]!, true, "Tests: 14 passed, 14 total", 6120),
    ],
    issues: [
      { severity: "high", message: tr(L, "A negative or non-numeric ?page crashes the route.", "Um ?page negativo ou não numérico derruba a rota."), file: "src/app/api/users/route.ts", line: 18 },
      { severity: "medium", message: tr(L, "No empty state when the page is past the last one.", "Sem estado vazio quando a página passa da última."), file: "src/components/UsersTable.tsx", line: 57 },
    ],
    fixIntro: tr(L, "Fixing the 3 issues: input validation first, then the empty state and the type error.", "Corrigindo os 3 problemas: validação da entrada primeiro, depois o estado vazio e o erro de tipo."),
    fix: [
      { name: "Edit", input: { file_path: "src/app/api/users/route.ts" }, output: "The file has been updated." },
      { name: "Edit", input: { file_path: "src/components/Pagination.tsx" }, output: "The file has been updated." },
      { name: "Edit", input: { file_path: "src/components/UsersTable.tsx" }, output: "The file has been updated." },
    ],
    fixSummary: tr(L, "Validated `page` with zod (400 on bad input), added an empty state and fixed the type.", "Validei `page` com zod (400 em entrada inválida), adicionei um estado vazio e corrigi o tipo."),
    approvedSummary: tr(L, "Pagination works end to end, bad input is rejected and all checks pass. Safe to merge.", "A paginação funciona de ponta a ponta, entradas inválidas são rejeitadas e todas as verificações passam. Seguro para merge."),
    concernsSummary: tr(L, "Close, but the route accepts invalid input and the types don't compile.", "Quase lá, mas a rota aceita entrada inválida e os tipos não compilam."),
    suggestedRule: tr(L, "Validate API input with zod.", "Validar a entrada da API com zod."),
    approveOnRound: 2,
    diff: [
      patch("src/app/api/users/route.ts", "modified", "@@ -1,5 +1,13 @@", [
        "+import { z } from \"zod\";",
        "+",
        "+const query = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });",
        "+",
        "-export async function GET() {",
        "-  return Response.json(await db.user.findMany());",
        "+export async function GET(req: Request) {",
        "+  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));",
        "+  if (!parsed.success) return Response.json({ error: \"Invalid page\" }, { status: 400 });",
        "+  const { page, pageSize } = parsed.data;",
        "+  const [items, total] = await Promise.all([db.user.findMany({ skip: (page - 1) * pageSize, take: pageSize }), db.user.count()]);",
        "+  return Response.json({ items, total, page, pageSize });",
        " }",
      ]),
      patch("src/components/Pagination.tsx", "added", "@@ -0,0 +1,14 @@", [
        "+export function Pagination({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {",
        "+  const pages = Math.max(1, Math.ceil(total / pageSize));",
        "+  return (",
        "+    <nav aria-label=\"Pagination\" className=\"flex items-center gap-2\">",
        "+      <a href={`?page=${page - 1}`} aria-disabled={page <= 1}>Previous</a>",
        "+      <span>",
        "+        {page} / {pages}",
        "+      </span>",
        "+      <a href={`?page=${page + 1}`} aria-disabled={page >= pages}>Next</a>",
        "+    </nav>",
        "+  );",
        "+}",
      ]),
      patch("src/components/UsersTable.tsx", "modified", "@@ -1,4 +1,12 @@", [
        "-export function UsersTable({ users }) {",
        "-  return <table>…</table>;",
        "+export function UsersTable({ users, page, total, pageSize }: UsersTableProps) {",
        "+  if (users.length === 0) return <EmptyState title=\"No users on this page\" />;",
        "+  return (",
        "+    <>",
        "+      <table>…</table>",
        "+      <Pagination page={page} total={total} pageSize={pageSize} />",
        "+    </>",
        "+  );",
        " }",
      ]),
    ],
  };
}

export function apiValidationScenario(L: Locale): ScenarioContent {
  return {
    explore: [{ name: "Grep", input: { pattern: "searchParams" }, output: "src/routes/orders.ts:12\nsrc/routes/users.ts:9" }],
    plan: tr(L, "Two routes read query params without validation. I'll add a shared zod schema.", "Duas rotas leem parâmetros sem validação. Vou adicionar um schema zod compartilhado."),
    build: [
      { name: "Write", input: { file_path: "src/lib/pagination.ts" }, output: "File created." },
      { name: "Edit", input: { file_path: "src/routes/orders.ts" }, output: "The file has been updated." },
      { name: "Edit", input: { file_path: "src/routes/users.ts" }, output: "The file has been updated." },
    ],
    summary: tr(L, "Invalid pagination input now returns 400 with a clear message in both routes.", "Entradas de paginação inválidas agora retornam 400 com uma mensagem clara nas duas rotas."),
    firstChecks: [check(API_CHECKS[0]!, true, "", 3900), check(API_CHECKS[1]!, true, "Tests: 31 passed, 31 total", 5200)],
    issues: [],
    fixIntro: "",
    fix: [],
    fixSummary: "",
    approvedSummary: tr(L, "Small, shared validation with tests for bad input. Safe to merge.", "Validação pequena e compartilhada, com testes para entradas inválidas. Seguro para merge."),
    concernsSummary: "",
    approveOnRound: 1,
    diff: [
      patch("src/lib/pagination.ts", "added", "@@ -0,0 +1,6 @@", [
        "+import { z } from \"zod\";",
        "+",
        "+export const pagination = z.object({",
        "+  page: z.coerce.number().int().min(1).default(1),",
        "+  pageSize: z.coerce.number().int().min(1).max(100).default(20),",
        "+});",
      ]),
      patch("src/routes/orders.ts", "modified", "@@ -10,4 +10,6 @@", [
        "-  const page = Number(req.query.page ?? 1);",
        "+  const parsed = pagination.safeParse(req.query);",
        "+  if (!parsed.success) return res.status(400).json({ error: \"Invalid pagination\" });",
        "+  const { page, pageSize } = parsed.data;",
      ]),
    ],
  };
}

export function pixScenario(L: Locale): ScenarioContent {
  return {
    explore: [{ name: "Read", input: { file_path: "src/payments/gateway.ts" }, output: "export const gateway = createStripeGateway(env.STRIPE_KEY);" }],
    plan: tr(L, "Replacing the card gateway with a Pix provider and a QR code checkout step.", "Trocando o gateway de cartão por um provedor Pix e um passo de checkout com QR code."),
    build: [
      { name: "Write", input: { file_path: "src/payments/pix.ts" }, output: "File created." },
      { name: "Edit", input: { file_path: "src/payments/gateway.ts" }, output: "The file has been updated." },
    ],
    summary: tr(L, "Added a Pix gateway and a QR code step at checkout.", "Adicionei um gateway Pix e um passo de QR code no checkout."),
    firstChecks: [check(SHOP_CHECKS[0]!, false, "✕ refunds a paid order (expected 'refunded', got 'pending')", 3400)],
    issues: [{ severity: "high", message: tr(L, "Refunds still go through the old card gateway.", "Os reembolsos ainda passam pelo gateway antigo de cartão."), file: "src/payments/refunds.ts", line: 22 }],
    fixIntro: tr(L, "Moving refunds to the Pix provider.", "Movendo os reembolsos para o provedor Pix."),
    fix: [{ name: "Edit", input: { file_path: "src/payments/refunds.ts" }, output: "The file has been updated." }],
    fixSummary: tr(L, "Refunds now call the Pix API, but the sandbox doesn't support partial refunds.", "Os reembolsos agora chamam a API do Pix, mas o sandbox não suporta reembolso parcial."),
    approvedSummary: "",
    concernsSummary: tr(L, "Partial refunds still fail in the sandbox. Decide whether to ship without them.", "Reembolsos parciais ainda falham no sandbox. Decida se dá para lançar sem eles."),
    approveOnRound: 99,
    diff: [
      patch("src/payments/pix.ts", "added", "@@ -0,0 +1,5 @@", [
        "+export async function createCharge(orderId: string, amountCents: number) {",
        "+  const res = await pix.post(\"/charges\", { orderId, amount: amountCents });",
        "+  return { qrCode: res.data.qr_code, expiresAt: res.data.expires_at };",
        "+}",
        "+",
      ]),
    ],
  };
}

export function simpleDoneScenario(L: Locale, title: string, files: string[]): ScenarioContent {
  return {
    ...apiValidationScenario(L),
    explore: [{ name: "Glob", input: { pattern: "src/**/*.tsx" }, output: "src/app/layout.tsx\nsrc/components/Header.tsx" }],
    build: files.map((f, i) => ({ name: i === 0 ? "Write" : "Edit", input: { file_path: f }, output: i === 0 ? "File created." : "The file has been updated." })),
    plan: tr(L, `Working on: ${title}.`, `Trabalhando em: ${title}.`),
    summary: tr(L, `Done: ${title}.`, `Pronto: ${title}.`),
    diff: [],
  };
}

export type VerdictFor = (round: number, approved: boolean) => Verdict;
