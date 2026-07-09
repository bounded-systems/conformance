#!/usr/bin/env -S deno run --allow-run=gh --allow-env
/**
 * actions.ts — org-wide, REPORT-ONLY actions-conformance audit.
 *
 * The org normalizes CI to a small canonical set of actions owned by the reusable
 * workflows in bounded-systems/.github, so repos only *configure* a thin caller. This
 * audit measures how far each repo is from that, against three rules:
 *
 *   R1 tamper   — a reference to an org reusable workflow (bounded-systems/.github/…)
 *                 must be pinned to a 40-hex SHA (not @main/tag), so a branch can't
 *                 swap the logic that gates it.
 *   R3 pin      — every external action `uses:` must be pinned to a 40-hex SHA
 *                 (org policy: sha_pinning_required).
 *   R2 indirect — (informational) third-party actions used OUTSIDE the canonical
 *                 reusable-workflow set: candidates that should route through one.
 *
 * Report-only: always exits 0 (like scripts/audit.mjs). Promote to a blocking
 * per-repo gate later (via repo-standard). Reads public repos with the default
 * token — no org-admin needed.
 */
const ORG = "bounded-systems";
const DOT_GITHUB = ".github"; // the reusable-workflow host
const SHA = /^[0-9a-f]{40}$/;
const USES = /^\s*-?\s*uses:\s*['"]?([^'"\s#`]+)/gm;

async function gh(path: string, raw = false): Promise<string> {
  const args = ["api", path];
  if (raw) args.push("-H", "Accept: application/vnd.github.raw");
  const cmd = new Deno.Command("gh", { args, stdout: "piped", stderr: "null" });
  const { code, stdout } = await cmd.output();
  return code === 0 ? new TextDecoder().decode(stdout) : "";
}
async function ghList(args: string[]): Promise<string> {
  const cmd = new Deno.Command("gh", { args, stdout: "piped", stderr: "null" });
  const { code, stdout } = await cmd.output();
  return code === 0 ? new TextDecoder().decode(stdout) : "";
}
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        res[idx] = await fn(items[idx]);
      }
    }),
  );
  return res;
}

type Ref = { action: string; version: string };
const owner = (a: string) => a.split("/")[0];
const isLocal = (a: string) =>
  a.startsWith("./") || a === "." || a.startsWith("docker://");
// An org reusable workflow is any bounded-systems/<repo>/.github/workflows/<f>.yml —
// hosted in .github OR in mint/baobab/gh-project-room/etc. (not just DOT_GITHUB).
const isOrgReusable = (a: string) =>
  owner(a) === ORG && a.includes("/.github/workflows/");
const isThirdParty = (a: string) =>
  !isLocal(a) && owner(a) !== "actions" && owner(a) !== "github" &&
  owner(a) !== ORG;
// classify the ref after `@`: an immutable SHA, a (mutable-but-conventional) tag, or a floating branch.
const refKind = (v: string): "sha" | "tag" | "branch" =>
  SHA.test(v) ? "sha" : /^v?\d/.test(v) ? "tag" : "branch";

async function workflowRefs(
  repo: string,
): Promise<Array<{ path: string } & Ref>> {
  const treeRaw = await gh(`repos/${ORG}/${repo}/git/trees/HEAD?recursive=1`);
  if (!treeRaw) return [];
  const paths: string[] = (JSON.parse(treeRaw).tree ?? [])
    .filter((n: { type: string; path: string }) =>
      n.type === "blob" && /^\.github\/workflows\/.*\.ya?ml$/.test(n.path)
    )
    .map((n: { path: string }) => n.path);
  const out: Array<{ path: string } & Ref> = [];
  for (const path of paths) {
    const content = await gh(`repos/${ORG}/${repo}/contents/${path}`, true);
    for (const m of content.matchAll(USES)) {
      const full = m[1];
      const at = full.lastIndexOf("@");
      out.push({
        path,
        action: at === -1 ? full : full.slice(0, at),
        version: at === -1 ? "" : full.slice(at + 1),
      });
    }
  }
  return out;
}

// canonical set = actions referenced by .github's repo-*.yml reusable workflows
async function canonicalSet(): Promise<Set<string>> {
  const treeRaw = await gh(
    `repos/${ORG}/${DOT_GITHUB}/git/trees/HEAD?recursive=1`,
  );
  const paths: string[] = (JSON.parse(treeRaw).tree ?? [])
    .filter((n: { path: string }) =>
      /^\.github\/workflows\/repo-.*\.ya?ml$/.test(n.path)
    )
    .map((n: { path: string }) => n.path);
  const set = new Set<string>();
  for (const p of paths) {
    const c = await gh(`repos/${ORG}/${DOT_GITHUB}/contents/${p}`, true);
    for (const m of c.matchAll(USES)) {
      if (isThirdParty(m[1].replace(/@.*/, ""))) {
        set.add(m[1].replace(/@.*/, ""));
      }
    }
  }
  return set;
}

// --- run ---
const names: string[] = JSON.parse(
  await ghList([
    "repo",
    "list",
    ORG,
    "--limit",
    "300",
    "--no-archived",
    "--json",
    "name",
  ]),
).map((r: { name: string }) => r.name);
const canonical = await canonicalSet();
const all = await pool(
  names,
  10,
  async (repo) => ({ repo, refs: await workflowRefs(repo) }),
);

const r1branch: string[] = [], r1tag: string[] = [], r3: string[] = [];
const r2 = new Map<string, Set<string>>(); // action -> repos (sprawl outside canonical)
for (const { repo, refs } of all) {
  for (const { path, action, version } of refs) {
    if (isLocal(action)) continue;
    const kind = refKind(version);
    const loc = `${repo}/${path}  ${action}@${version || "(none)"}`;
    if (isOrgReusable(action)) {
      if (kind === "branch") r1branch.push(loc);
      else if (kind === "tag") r1tag.push(loc);
    } else if (kind !== "sha") {
      r3.push(loc); // external / org-owned action not SHA-pinned
    }
    if (isThirdParty(action) && !canonical.has(action)) {
      if (!r2.has(action)) r2.set(action, new Set());
      r2.get(action)!.add(repo);
    }
  }
}

const p = (s: string) => console.log(s);
p(`\n=== actions-conformance audit (report-only) — ${names.length} repos ===`);
p(`canonical set (from ${DOT_GITHUB} repo-*.yml): ${
  [...canonical].sort().join(", ") || "(none)"
}\n`);

p(`R1a — org reusable workflow on a FLOATING BRANCH ref (hard tamper risk): ${r1branch.length}`);
r1branch.sort().forEach((v) => p(`   ✗ ${v}`));
p(`\nR1b — org reusable workflow on a TAG (mutable; prefer SHA): ${r1tag.length}`);
r1tag.sort().forEach((v) => p(`   ⚠ ${v}`));
p(`\nR3 — external/org-owned action not SHA-pinned (org sha_pinning): ${r3.length}`);
r3.sort().forEach((v) => p(`   ✗ ${v}`));
p(`\nR2 — third-party actions outside the canonical set (indirection candidates): ${r2.size}`);
[...r2.entries()].sort((a, b) => b[1].size - a[1].size).forEach(([a, reps]) =>
  p(`   · ${a}  (${reps.size} repos)`)
);

p(`\nSummary: R1a=${r1branch.length} branch-pinned reusable, R1b=${r1tag.length} tag-pinned reusable, R3=${r3.length} unpinned external, R2=${r2.size} sprawl actions`);

// Phased promotion: report-only by default (like scripts/audit.mjs). With --strict,
// fail on the two HARD, objective rules (R1a floating-branch reusable, R3 unpinned
// external) while R1b (tag pins) and R2 (sprawl) stay informational.
if (Deno.args.includes("--strict")) {
  const hard = r1branch.length + r3.length;
  p(`\n--strict: ${hard} hard violations (R1a+R3).`);
  Deno.exit(hard > 0 ? 1 : 0);
}
p("Report-only: exit 0.");
