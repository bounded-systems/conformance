#!/usr/bin/env node
// Cross-repo structural-overlap audit — the fourth conformance axis.
//
// Beyond org-ruleset drift (apply-rulesets), the per-repo scorer (audit.mjs),
// and the drift gate (scripts/gate — contract vs code), this asks: is the same
// STRUCTURE copy-pasted across repos that should import a shared package?
//
// Two tools, run against the library repos checked out side by side:
//   jscpd    — Type-1/2/3 clone discovery (renamed vars still match). The
//              "measure": overall duplication ratio + a per-clone list. FAILS if
//              the ratio exceeds the budget OR a cross-repo clone appears whose
//              repo-pair is not allowlisted.
//   ast-grep — structural rules seeded from what discovery finds. The
//              "enforcement": FAILS on any error-severity rule match.
//
// Unlike audit.mjs (reports, always exits 0), this Deno.exit(1)s on findings —
// like the drift gate. Reads source read-only; product repos are never wired to
// it. Token posture: `contents: read` only.
//
//   node scripts/overlap/overlap.mjs                 # repos are siblings (../<name>)
//   node scripts/overlap/overlap.mjs --repos-dir=_repos
//   node scripts/overlap/overlap.mjs --only=jscpd    # or --only=astgrep
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq === -1) out[a.slice(2)] = true;
    else out[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const only = typeof args.only === "string" ? args.only : null;
const config = JSON.parse(
  readFileSync(join(REPO_ROOT, "overlap.config.json"), "utf8"),
);

// Where the repos are checked out, each as a `<reposDir>/<name>` subdir. Locally
// they are siblings of conformance (../<name>); CI checks them into `_repos/`.
const reposDir = typeof args["repos-dir"] === "string"
  ? args["repos-dir"]
  : join(REPO_ROOT, "..");

const present = config.repos.filter((r) => existsSync(join(reposDir, r)));
const missing = config.repos.filter((r) => !existsSync(join(reposDir, r)));

const repoOf = (p) => p.replaceAll("\\", "/").split("/")[0];

// ---- jscpd: clone discovery + budget + cross-repo allowlist ----------------
function runJscpd() {
  const out = mkdtempSync(join(tmpdir(), "jscpd-"));
  const { pattern, ignore, minTokens, minLines } = config.jscpd;
  try {
    execFileSync(
      "npx",
      [
        "--yes",
        "jscpd@4",
        ...present,
        "--pattern",
        pattern,
        "--ignore",
        ignore,
        "--min-tokens",
        String(minTokens),
        "--min-lines",
        String(minLines),
        "--reporters",
        "json",
        "--output",
        out,
        "--mode",
        "mild",
        "--silent",
      ],
      { cwd: reposDir, stdio: ["ignore", "ignore", "inherit"] },
    );
  } catch { /* jscpd exits non-zero when clones found with a threshold; we read the report either way */ }

  const report = JSON.parse(readFileSync(join(out, "jscpd-report.json"), "utf8"));
  const pct = report.statistics?.total?.percentage ?? 0;
  const dupLines = report.statistics?.total?.duplicatedLines ?? 0;
  const totalLines = report.statistics?.total?.lines ?? 0;

  const allow = new Set(
    (config.crossRepoAllowlist ?? []).map((e) => e.pair.slice().sort().join("~")),
  );
  const crossRepo = [];
  const withinCounts = {};
  for (const c of report.duplicates ?? []) {
    const a = repoOf(c.firstFile.name);
    const b = repoOf(c.secondFile.name);
    if (a === b) {
      withinCounts[a] = (withinCounts[a] ?? 0) + 1;
      continue;
    }
    const key = [a, b].sort().join("~");
    crossRepo.push({
      a,
      b,
      allowed: allow.has(key),
      fileA: c.firstFile.name,
      fileB: c.secondFile.name,
      lines: c.lines,
    });
  }

  const budget = config.jscpd.maxDuplicationPct;
  const overBudget = pct > budget;
  const notAllowed = crossRepo.filter((c) => !c.allowed);

  const failures = [];
  if (overBudget) {
    failures.push(
      `duplication ratio ${pct.toFixed(2)}% exceeds budget ${budget}%`,
    );
  }
  for (const c of notAllowed) {
    failures.push(
      `un-allowlisted cross-repo clone: ${c.a} ↔ ${c.b} (${c.lines}L) — ${c.fileA} / ${c.fileB}`,
    );
  }

  return {
    name: "jscpd",
    ok: failures.length === 0,
    failures,
    pct,
    dupLines,
    totalLines,
    budget,
    crossRepo,
    withinCounts,
  };
}

// ---- ast-grep: structural enforcement rules --------------------------------
function astGrepCmd() {
  // Prefer a PATH `ast-grep`; fall back to the npm package runner.
  try {
    execFileSync("ast-grep", ["--version"], { stdio: "ignore" });
    return ["ast-grep", []];
  } catch {
    return ["npx", ["--yes", "--package", "@ast-grep/cli", "ast-grep"]];
  }
}

function runAstGrep() {
  const sgconfig = join(HERE, "sgconfig.yml");
  const [bin, pre] = astGrepCmd();
  let raw = "[]";
  try {
    raw = execFileSync(
      bin,
      [...pre, "scan", "-c", sgconfig, "--json=compact", reposDir],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    // ast-grep scan exits non-zero when it finds error-severity matches; the
    // JSON still comes on stdout.
    raw = e.stdout?.toString() || "[]";
  }
  let matches = [];
  try {
    matches = JSON.parse(raw);
  } catch {
    matches = [];
  }
  const errors = matches.filter((m) => (m.severity ?? "error") === "error");
  const failures = errors.map((m) => {
    const rel = m.file.replaceAll("\\", "/");
    const line = (m.range?.start?.line ?? 0) + 1;
    return `[${m.ruleId}] ${rel}:${line} — ${m.message}`;
  });
  return { name: "ast-grep", ok: failures.length === 0, failures, matches };
}

// ---- run + report ----------------------------------------------------------
const results = [];
let jscpd, astgrep;
if (!only || only === "jscpd") {
  jscpd = runJscpd();
  results.push(jscpd);
}
if (!only || only === "astgrep") {
  astgrep = runAstGrep();
  results.push(astgrep);
}

const md = [];
md.push("# conformance — cross-repo structural-overlap audit", "");
md.push(`Repos scanned: ${present.map((r) => `\`${r}\``).join(", ")}`);
if (missing.length) {
  md.push(`Repos not checked out (skipped): ${missing.map((r) => `\`${r}\``).join(", ")}`);
}
md.push("");
md.push("| check | status | detail |", "| --- | :-: | --- |");
for (const r of results) {
  let detail;
  if (r.name === "jscpd") {
    detail = `${r.pct.toFixed(2)}% dup (budget ${r.budget}%), ${r.crossRepo.length} cross-repo clone(s)`;
  } else {
    detail = `${r.matches.length} rule match(es)`;
  }
  md.push(`| ${r.name} | ${r.ok ? "✅" : "❌"} | ${detail} |`);
}
md.push("");

if (jscpd) {
  md.push("## Duplication (jscpd)", "");
  md.push(
    `Overall: **${jscpd.pct.toFixed(2)}%** (${jscpd.dupLines}/${jscpd.totalLines} lines), budget ${jscpd.budget}%.`,
    "",
  );
  if (jscpd.crossRepo.length) {
    md.push("### Cross-repo clones", "");
    md.push("| repos | lines | allow | files |", "| --- | :-: | :-: | --- |");
    for (const c of jscpd.crossRepo) {
      md.push(
        `| ${c.a} ↔ ${c.b} | ${c.lines} | ${c.allowed ? "✅" : "❌ NEW"} | \`${c.fileA}\` / \`${c.fileB}\` |`,
      );
    }
    md.push("");
  } else {
    md.push("_No cross-repo clones._", "");
  }
  const within = Object.entries(jscpd.withinCounts).sort((a, b) => b[1] - a[1]);
  if (within.length) {
    md.push(
      "### Within-repo clones (informational)",
      "",
      within.map(([r, n]) => `- \`${r}\`: ${n}`).join("\n"),
      "",
    );
  }
}

if (astgrep) {
  md.push("## Structural rules (ast-grep)", "");
  if (astgrep.matches.length) {
    for (const f of astgrep.failures) md.push(`- ❌ ${f}`);
  } else {
    md.push("_No rule matches._");
  }
  md.push("");
}

const ok = results.every((r) => r.ok);
md.push(ok ? "✓ overlap audit passed" : "✗ overlap audit FAILED", "");
const report = md.join("\n");

// OVERLAP.md is the checked-in snapshot (like CONFORMANCE.md), regenerated on demand.
writeFileSync(join(REPO_ROOT, "OVERLAP.md"), report + "\n");
console.log(report);

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n", { flag: "a" });
  } catch { /* best-effort */ }
}

if (!ok) {
  for (const r of results) {
    for (const f of r.failures) console.error(`  ✗ ${f}`);
  }
}
process.exit(ok ? 0 : 1);
