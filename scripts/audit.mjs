#!/usr/bin/env node
// Conformance audit — scores every (non-archived, non-fork) org repo's DEFAULT
// BRANCH against the default-branch standard (rulesets/default-branch.json).
// Reads the *effective* rules on each branch (GET /repos/{o}/{r}/rules/branches/{b}),
// which combines org rulesets + repo rulesets + classic protection — so it reports
// reality, not intent. Zero-dep; shells to `gh`. Writes CONFORMANCE.md + exits 0.
//
//   node scripts/audit.mjs            # writes CONFORMANCE.md
//   ORG=bounded-systems node scripts/audit.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const ORG = process.env.ORG || "bounded-systems";
// The rule types the standard requires (must match rulesets/default-branch.json).
const STANDARD = ["pull_request", "required_signatures", "required_linear_history", "non_fast_forward", "deletion"];
const ICON = { pull_request: "PR", required_signatures: "sign", required_linear_history: "linear", non_fast_forward: "no-ff", deletion: "no-del" };

const gh = (path) => JSON.parse(execFileSync("gh", ["api", path, "--paginate"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));

const repos = gh(`orgs/${ORG}/repos?per_page=100`)
  .filter((r) => !r.archived && !r.fork)
  .sort((a, b) => a.name.localeCompare(b.name));

const rows = [];
for (const r of repos) {
  let have = new Set();
  try {
    const rules = gh(`repos/${ORG}/${r.name}/rules/branches/${encodeURIComponent(r.default_branch)}`);
    have = new Set(rules.map((x) => x.type));
  } catch { /* no access / empty → treated as ungoverned */ }
  const missing = STANDARD.filter((t) => !have.has(t));
  rows.push({ name: r.name, priv: r.private, missing, ok: missing.length === 0 });
  process.stderr.write(`. ${r.name}${missing.length ? " ✗" : " ✓"}\n`);
}

const ok = rows.filter((r) => r.ok).length;
const md = [
  `# Conformance — default-branch standard`,
  ``,
  `Scored against [\`rulesets/default-branch.json\`](rulesets/default-branch.json) via each repo's *effective* branch rules.`,
  ``,
  `**${ok}/${rows.length} repos conformant.** Columns mark a ✓ when the rule is in effect on the default branch.`,
  ``,
  `| repo | ${STANDARD.map((t) => ICON[t]).join(" | ")} | conformant |`,
  `| --- | ${STANDARD.map(() => ":-:").join(" | ")} | :-: |`,
  ...rows.map((r) => `| ${r.name}${r.priv ? " 🔒" : ""} | ${STANDARD.map((t) => (r.missing.includes(t) ? "·" : "✓")).join(" | ")} | ${r.ok ? "✅" : ""} |`),
].join("\n") + "\n";

writeFileSync("CONFORMANCE.md", md);
console.log(`✓ wrote CONFORMANCE.md — ${ok}/${rows.length} conformant`);
