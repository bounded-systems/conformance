# CI Audit — overlap, variance, and gaps (2026-06-29)

Inventoried the workflows of all **72** non-archived, non-fork `bounded-systems`
repos (`scripts/audit.mjs` covers branch governance; this is the workflow layer).
Read against the **target behaviors** the org is actually aiming for: supply-chain
integrity (capability-security ethos, SHA-pinning, provenance, the trust ledger),
reproducible publish, governed branches, and "everything is a derivation."

## 1. Overlap — the de-facto package standard (good)

A clear, consistent shape has emerged for library/package repos:

| workflow | repos | role |
|---|--:|---|
| `ci.yml` | 47/72 | test/lint gate |
| `publish*` (jsr/npm/ghcr/flakehub) | 47/72 | publish artifact |
| `release.yml` | 36/72 | cut release |
| `version.yml` + changesets | 34/72 | versioning |
| `front-desk-add` / `notify-front-desk` | 18/72 | project tracking |

The **build → version → release → publish** chain is genuinely standardized. This
is the org's strength: most packages look alike and ship alike.

## 2. Variance — standardized by COPY, not DERIVATION (the core problem)

The overlap above is by **filename/template**, not shared source. Evidence:
- `.github` exposes reusable workflows (`site-deploy`, `seam-coverage`,
  `front-desk-add`, `notify-front-desk`, `registry-graph`, `knowledge-check`).
- But **CI is never derived**: 6/6 sampled `ci.yml` are inline (0 reusable calls);
  **1** code hit org-wide references a shared CI workflow.
- So ~47 independent `ci.yml` copies **drift**. This is exactly why enabling the
  org SHA-pinning rule broke CI in repos one-by-one (`cf-oidc-token-broker`,
  `fold-engine`) instead of all updating from a single source.

**Only deploy is derived** (`site-deploy.yml@sha`, 3 sites) — and it's the one area
that updates org-wide from one place. That's the model the rest should follow.

## 3. Gaps vs. target business behavior

| target behavior | current coverage | gap |
|---|--:|---|
| **Supply-chain integrity** (CodeQL/OSV/SBOM/Scorecard/provenance) | **4/72** | 🔴 severe — only `prx` has the suite; near-zero elsewhere despite this being the org's headline value |
| **Governed default branch** (PR/signed/linear) | **1/72** | 🔴 only `.github` (see `CONFORMANCE.md`) |
| **Any CI at all** | 63/72 | 🟡 9 repos have none (`trust`, `dev-registry`, `frond`, `schema-bridge`, `lima-devshell`, `unfold-obsidian-vault`, `dev-contracts-extract`/`-transform`, + `conformance`) |
| Reproducible publish | 47/72 | 🟢 strong, but copied (drifts) + not universal |
| Site/content conformance (conformance-kit) | ~4/72 | 🟢 appropriate — only sites need it |

The standout: **supply-chain enforcement is 4/72** while it's the most-stated org
value. SHA-pinning is enforced org-wide (an Actions *policy*), but the *scanning/
attestation* gates (CodeQL, OSV, SBOM, Scorecard, sigstore/provenance) live almost
only in `prx`.

## 4. Recommendations (highest leverage first)

1. **Make CI a derivation, not a copy.** Extract the common `ci.yml` into a
   reusable workflow in `.github` (as `site-deploy` already is); repos call it
   with `uses:`. Kills drift — the next policy change updates everyone at once.
2. **Baseline security workflow, org-wide.** One reusable supply-chain workflow
   (CodeQL + OSV + SBOM + Scorecard), mandated via GitHub **required workflows**
   (org → Actions). Closes the 4/72 → near-72/72 gap — the biggest miss vs the
   capability-security ethos.
3. **Branch governance** via the ruleset already defined here
   (`rulesets/default-branch.json`, currently disabled): roll out the low-friction
   rules first (PR/linear/no-ff/no-del), migrate automation to signed commits, then
   enable `required_signatures`.
4. **Triage the 9 no-CI repos** — some are content/inactive (fine); others should
   at least call the baseline CI + security reusable workflows.

The through-line: the org **standardizes by template (drifts) and under-enforces
supply-chain**. Both are fixed by the same move it already uses for deploy —
**derive from shared reusable workflows + enforce with required workflows + the
branch ruleset** — which is the "everything is a derivation" principle applied to CI.

---

## Update — normalization shipped (2026-06-29)

The "derive not copy" fix is built and proven:
- **`bounded-systems/.github` → `repo-standard.yml`** — one reusable workflow, opt-in
  inputs (`security`, `test` + `runtime`/`test-command`). Security baseline = OSV
  (report-only) + dependency-review (report-only), copied from prx's proven SHA-pinned
  workflows, generalized language-agnostic.
- **[`templates/standard.yml`](templates/standard.yml)** — the single thin caller each
  repo drops in (and deletes its bespoke `ci.yml`).
- **First adoption: `cas`** — replaced `ci.yml` with the caller; all three jobs
  (`osv` / `dependency-review` / `test`) green through the shared workflow.

**Rollout:** migrate repos to the caller (delete bespoke `ci.yml`, add `standard.yml`
with this repo's `runtime`/`test-command`). Each migration moves one repo from a
drifting copy to the derived standard — and turns on the security baseline it lacked
(closing the 4/72 gap one repo at a time). The audit (`scripts/audit.mjs`) + a future
"has standard.yml" check measure progress.

---

## Update — enforcement wired (2026-06-30)

- **CI normalization rolled out: 42 repos** migrated `ci.yml` → the thin `standard.yml`
  caller (bun/deno/node/nix/rust), each verified green. Declined (would regress):
  `dev-contracts` (mise/trunk), `string-audit` (submodules + daemon pipeline), `prx`
  (own full suite).
- **Enforced security floor:** `.github/workflows/required-baseline.yml` (OSV +
  dependency-review, report-only) + org ruleset `required-baseline`
  ([rulesets/required-baseline.json](rulesets/required-baseline.json), a `workflows`
  rule). Injects the scan on **every** repo's PRs — adopted, un-adopted, and future —
  not just opt-in. Shipped **`enforcement: disabled`**; flip to `active` to require it.

Net: drift→derivation for the bulk of repos, plus an enforcement lever that covers the
long tail. Re-run `scripts/audit.mjs` to watch governance climb; `apply-rulesets.sh`
owns both rulesets as code.
