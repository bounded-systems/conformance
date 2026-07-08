# Consolidation — `conformance` as the org-governance engine

**Decision (2026-07-08):** one org-governance-as-code system, split implementation vs config.

- **`conformance` (this repo) = the implementation** — the reusable engine: Zod-validated schema,
  `validate | audit | sync` for rulesets + custom properties + OIDC, drift detection, and the
  per-repo effective-rules scorer (`scripts/audit.mjs`). Mirrors `conformance-kit`'s "site-agnostic,
  vendored by consumers" model — a governance *tool*, not a place for one org's values.
- **`bounded-systems/.github-private` `org/` = the config** — this org's actual rulesets/properties/
  OIDC *values* (private). It **consumes** this engine (vendor / submodule / import as dep).

This supersedes the earlier duplication: a richer Deno+Zod toolchain was built in `.github-private/
org/` during the 2026-07-08 hardening pass (and used to activate branch protection, code security,
OIDC `tier` claims, and repo policies org-wide). That tooling folds *here* as the engine; its config
files stay in `.github-private/org/`.

## Migration (Epic 1)

1. **Port the engine** — bring the Deno+Zod tooling (`schema.ts` incl. lockout + property guards,
   `cli.ts`, `props.ts`, `oidc.ts`, `gh.ts`) into this repo, parameterized by a config path (so it is
   config-agnostic). Adopt Deno in the flake (add `deno` + `gh`). This replaces
   `scripts/apply-rulesets.sh` (→ `deno task …:sync`).
2. **Keep `scripts/audit.mjs`** — the per-repo effective-rules scorer is a distinct axis the engine
   lacks (org + repo + classic rules = reality, not intent). Two audits: "does committed match live?"
   (engine drift) and "does each repo meet the standard?" (scorer).
3. **Config lives in the consumer** — `.github-private/org/{rulesets,properties,oidc}/` are the source
   of truth values; this repo's `rulesets/*.json` become either fixtures or move out. **Hard
   constraint:** the live rulesets are ACTIVE — the config the engine applies must match live (zero
   drift) before any apply runs from here, or an apply reverts live protection.
4. **Wire CI** — validate on PR, scheduled drift audit (reuse the org-admin GitHub App token path).
5. **Re-run `audit.mjs`** — it last read **1/72 conformant** (rulesets were disabled). The 2026-07-08
   activation met the standard org-wide, so it should now read ~72/72 — validating the work against
   this repo's own scorer.

## Then (separate epics)

- **Epic 2 — caller rollout:** propagate `repo-standard.yml` (now incl. scorecard + sbom) via
  `templates/standard.yml`; keystone = add the `github-actions` Dependabot ecosystem to the 42 callers
  missing it (only 1/43 has it, so pins are frozen); add callers to the 29 bare repos; turn on
  `descriptor` + `trellis.json` for enforced README generation.
- **Epic 3 — enforcement:** committed-disabled `file_path_restriction` ruleset on `.github/workflows/**`
  (OrgAdmin bypass); Actions policy; a standing workflow-conformance audit. Activate post-rollout.
