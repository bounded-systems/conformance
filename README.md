# conformance

**Org/repo conformance as code.** The standard every bounded-systems repo should
meet — defined as version-controlled rulesets — plus an audit that scores every
repo against it. This is the *repo/governance* conformance layer:

| layer | concern | home |
|---|---|---|
| [conformance-kit](https://github.com/bounded-systems/conformance-kit) | does a **site's content** conform? (a11y, SEO, SHACL, provenance) | `conformance-kit` |
| **this repo** | does a **repo** meet the org governance standard? (branch rules, signing) | `conformance` |
| [fleet](https://github.com/bounded-systems/fleet) | is a repo's CI **green right now**? | `fleet` |

## Audit vs gate

Two words recur across this repo's scripts and workflows, and they mean
different things on purpose:

- **audit** — reports, never blocks. Always exits 0 (or, for a CI step, is
  never a required check). Answers "where do we stand?" without touching a
  PR's mergeability. Its output is a checked-in snapshot (`CONFORMANCE.md`,
  `OVERLAP.md`) — the dry run.
- **gate** — enforces. Exits non-zero (or fails the CI step) the moment it
  finds something wrong. Answers "can this merge?"

| script / workflow | mode | exits 1 on... |
|---|:-:|---|
| `scripts/audit.mjs` | audit | never — always exits 0 |
| `scripts/open-prs.sh` | audit | never — a digest, not a check |
| `scripts/gate/gate.ts` (`conformance-gate.yml`) | gate | descriptor or surface drift |
| `scripts/overlap/overlap.mjs` (`overlap-gate.yml`) | **both** | default = gate (any flag); `--report-only` = audit (never) |
| `spell-gate.yml` (cspell) | gate | any token outside the dictionary/allowlist |
| `scripts/apply-rulesets.sh` | *(mutator — not audit or gate; it writes org settings)* | — |

The overlap check is the one script with both modes, wired by CI trigger: see
"Cross-repo overlap audit" below.

## The standard

[`rulesets/default-branch.json`](rulesets/default-branch.json) — the default branch
of every repo should: require a **PR** before merge, a **linear history**, **signed
commits**, and forbid **force-push** and **deletion**. (Mirrors the ruleset already
on `.github`, generalized org-wide.)

It is the single source of truth: edit the JSON, run `scripts/apply-rulesets.sh`,
review in [org settings → Rules](https://github.com/organizations/bounded-systems/settings/rules).
No hand-clicking the UI.

## Current state

[`CONFORMANCE.md`](CONFORMANCE.md) — regenerate with `node scripts/audit.mjs`. It reads
each repo's *effective* branch rules (org + repo rulesets + classic protection), so it
reports reality, not intent.

> As of the first audit: **1/72 conformant**. Most repos share `PR/linear/no-ff/no-del`;
> the gaps are **signed commits** (only `.github` has it) and a set of repos with **no
> default-branch rules at all**.

## Cross-repo drift gate

A third audit axis, beyond the two above (org-ruleset drift and the per-repo
scorer): **does another repo's declared contract still match its code?** The
gate in [`scripts/gate/`](scripts/gate/) checks `@bounded-systems/guest-room`
from the outside and **fails** (exit non-zero — unlike `audit.mjs`, which only
reports) on drift. Both checks are delegated to the shared
[`@bounded-systems/drift-gate`](https://jsr.io/@bounded-systems/drift-gate)
engine — the same package [`trellis`](https://github.com/bounded-systems/trellis)
runs as its `descriptor-honesty` check — so there is a single source of truth
for the drift logic and conformance just points it at guest-room:

- **descriptor** — every `descriptor.proof.claims[]` in guest-room's
  `trellis.json` names a `provenBy` file that exists, and that file's git blob
  hash matches the pin in guest-room's generated README claims table. This is the
  external, org-level twin of the `descriptor-kit` check guest-room runs on
  itself — enforced from here; the product repo is never wired to this gate.
- **surface** — guest-room `mod.ts`'s exported symbols (extracted with the
  TypeScript compiler via `ts-morph`) match the checked-in golden
  [`goldens/guest-room.mod.surface.json`](goldens/guest-room.mod.surface.json).
  The golden is the pin; an intentional API change is acknowledged by
  regenerating it and committing the reviewable diff.

```sh
deno task gate                          # both checks; resolves ../guest-room locally
deno task gate:descriptor               # descriptor only
deno task gate:surface                  # surface only
deno task surface:update                # regenerate the golden after an intentional API change
```

Runs in CI via [`.github/workflows/conformance-gate.yml`](.github/workflows/conformance-gate.yml)
(PR + daily schedule). It reads **public** guest-room source, so it needs only
`contents: read` — no org-admin token. CI runs the org-standard Deno `v2.x`: the
surface projection now comes from `ts-morph` (pinned via drift-gate's TypeScript
dependency and recorded in the golden's `_generated.typescript`), so it no longer
depends on the deno version the way the old `deno doc --json` diff did.

## Cross-repo overlap audit

A **fourth** axis, beyond the three above: **is the same _structure_ copy-pasted
across repos that should import a shared package instead?** Where the drift gate
asks "does a repo's declared contract match its code," this asks "are two repos
quietly re-implementing the same thing." Two tools in
[`scripts/overlap/`](scripts/overlap/), run against the **library** repos
checked out side by side:

- **jscpd** (the *measure*) — Type-1/2/3 clone discovery (renamed variables still
  match, unlike the byte-exact descriptor pins). Reports the overall duplication
  ratio and every clone, and **flags** if the ratio exceeds the budget **or** a
  *cross-repo* clone appears whose repo-pair isn't in the allowlist. A cross-repo
  clone is the governance smell; the allowlist is where a deliberate, reviewed
  exception is acknowledged (with a reason and, ideally, a plan to retire it).
- **ast-grep** (the *enforcement*) — structural rules in
  [`scripts/overlap/rules/`](scripts/overlap/rules/), seeded from what discovery
  surfaces. **Flags** any error-severity match. The current set guards the
  **drift-gate consolidation boundary** — the three engine primitives PR #14
  moved into `@bounded-systems/drift-gate` (the git-blob-hash, the
  `<!-- descriptor:claims -->` table parser, and ts-morph surface extraction)
  must not be re-implemented anywhere else. Each rule matches only drift-gate
  itself today (which it exempts), so a green rule is a consolidation that hasn't
  regressed. New rules are added as discovery surfaces more.

Both tools run in **one of two modes** (see "Audit vs gate" above), same checks:

```sh
node scripts/overlap/overlap.mjs                 # GATE (default): exits 1 on any flag
node scripts/overlap/overlap.mjs --report-only   # AUDIT: always exits 0, still writes OVERLAP.md
node scripts/overlap/overlap.mjs --only=jscpd
node scripts/overlap/overlap.mjs --only=astgrep
```

Runs in CI via [`.github/workflows/overlap-gate.yml`](.github/workflows/overlap-gate.yml),
which checks the repos out into `_repos/` and picks the mode by trigger: `pull_request`
and manual runs are the **gate** (a PR can't introduce new overlap); `schedule` is the
**audit** (`--report-only` — tracks `OVERLAP.md` daily without ever reddening `main` on
its own, the same posture as `CONFORMANCE.md`). Reads **public** source, so
`contents: read` only. [`overlap.config.json`](overlap.config.json) holds the repo set,
the duplication budget, and the cross-repo allowlist.

> **Repo set:** every bounded-systems repo this session has access to except
> `claude-box` (an app repo with its own internal daemon boilerplate and a
> deliberately vendored guest-room mirror — a different, internal concern).
> Widening to the rest of the org is tracked in conformance#18; it needs those
> repos wired into CI's checkout list first. The jscpd pattern covers both
> `.ts` and `.mjs` (added for `verify`'s plain-JS source).

> **Known cross-repo clone (allowlisted, deliberate):** `trellis/check/lattice.ts`
> and `trellis-kit/mod.ts` both carry the same DFS cycle-detection helper. This is
> a *permanent* exception, not a pending extraction: `lattice.ts` runs sealed in a
> Nix derivation (`deno run --no-remote`) and so **cannot import** the kit — it must
> mirror it. The kit stays canonical; `lattice.ts` is its hermetic executor, and
> `trellis/check/lattice_test.ts` keeps the mirror faithful by asserting the two
> agree in ordinary CI. A *verified* mirror, not an asserted one — the same posture
> as the descriptor-honesty check.

## Rollout (important — `enforcement: "disabled"` for now)

The ruleset ships **disabled**: defined and reviewable, enforcing nothing. The org is on
the **Team** plan, which has no `evaluate` (dry-run) mode — so `CONFORMANCE.md` *is* the
dry run.

**Before flipping to `"active"`, mind the blast radius:** `required_signatures` will
reject every **unsigned bot/CI push** to a default branch — and the audit shows almost
no repo's automation signs today. Several pipelines push straight to `main`
(the `fleet` board, `brand`→profile, container/Pages publishers). Enforce in stages:

1. Land branch rules first (PR/linear/no-ff/no-del) — lower friction.
2. Migrate automation to signed commits (or add a scoped bypass for the bot), repo by repo.
3. Only then enable `required_signatures` org-wide.

(This is the same lesson the `fleet` board hit: an auto-committing bot needs either an
unprotected target or signed commits.)

## Layout

- `rulesets/*.json` — the standard, as org ruleset payloads.
- `scripts/apply-rulesets.sh` — create/update the org rulesets from the JSON.
- `scripts/audit.mjs` — score every repo; writes `CONFORMANCE.md`.
- `scripts/gate/` — the cross-repo drift gate (Deno); thin glue over
  `@bounded-systems/drift-gate`; `deno task gate`.
- `goldens/` — checked-in surface snapshots the gate diffs against.
- `gate.config.json` — what the gate points at (guest-room location).
- `scripts/overlap/` — the cross-repo overlap check (jscpd + ast-grep);
  `node scripts/overlap/overlap.mjs` (gate mode) or `--report-only` (audit mode).
- `overlap.config.json` — repo set, duplication budget, cross-repo allowlist.
- `OVERLAP.md` — the overlap check's checked-in snapshot.
- `.github/workflows/overlap-gate.yml` — runs it as a gate on PR/manual, an audit
  on the daily schedule.
- `deno.json` — gate task runners (`gate`, `gate:descriptor`, `gate:surface`, `surface:update`).
- `.github/workflows/conformance-gate.yml` — runs the gate on PR + daily schedule.
- `scripts/open-prs.sh` — org-level open-PR digest; writes `OPEN-PRS.md`.
- `cspell.json` — the spell-gate dictionary + project word allowlist.
- `scripts/enable-auto-merge.sh` — turn on GitHub auto-merge per repo.
- `rulesets/merge-queue.json` — optional merge-queue rule (ships disabled).

## Monitoring open PRs (org-level)

Three layers, cheapest first:

- **Ad-hoc:** `gh search prs --owner bounded-systems --state open` (add `--json`/`--jq`
  for checks, mergeable, age).
- **Saved:** bookmark <https://github.com/pulls?q=is:open+is:pr+org:bounded-systems>.
- **Persistent:** `bash scripts/open-prs.sh` regenerates [`OPEN-PRS.md`](OPEN-PRS.md);
  `.github/workflows/open-prs.yml` renders the same digest to the Actions run summary
  every weekday. (A Slack post or a `fleet` panel are natural next homes.)

> The digest flags **bot PRs**: with `required_signatures` active org-wide, a bot's
> unsigned PRs can't merge unless the bot signs or is a ruleset `bypass_actor`. Watch
> that count — it's how you catch Dependabot **security** updates stuck in the queue.

## Auto-merge & merge queue

GitHub's **auto-merge** ("merge when green") and **merge queue** are *off* today —
`OPEN-PRS.md` is a digest, not a GitHub queue. Turning them on takes three
ingredients, staged to keep the blast radius contained:

1. **`allow_auto_merge` per repo** — `scripts/enable-auto-merge.sh` flips it on for
   every non-archived, non-fork repo (needs an org-admin token). Harmless alone:
   it only makes the feature *available*.
2. **A required check to wait for** — auto-merge does nothing without one. Activate
   **`required-baseline.json`** (the shared workflow) by setting its `enforcement`
   to `"active"` and re-running `apply-rulesets.sh`. Do **not** activate
   `default-branch.json` for this yet — its `required_signatures` rule rejects
   every unsigned bot/CI push to `main` (fleet, publishers, mint), the blast
   radius the rollout notes warn about. Migrate those to signed commits first,
   separately.
3. **(Optional) a merge queue** — `rulesets/merge-queue.json` adds a serialized
   rebase-test-merge queue (`SQUASH`, all-green grouping). Ships **disabled**;
   activate it the same way once auto-merge is proven.

Then, per PR: `gh pr merge <n> --auto --squash`. `audit.mjs` is the dry-run for
whether the required-check spread is safe to activate org-wide.

## Spell gate

`spell-gate.yml` runs [`cspell`](https://cspell.org): CI **fails on any token not
in the English/software dictionaries or the `words` allowlist in `cspell.json`**.
This catches nonsense and promotional insertions *proactively* — a smuggled
product name isn't a word, so it fails unless someone adds it to the allowlist,
which is a **reviewed diff** (the gate: a reviewer sees new dictionary entries and
can reject a brand insertion). Keep `words` sorted, real project/tech terms only.
Intended to move into `repo-standard.yml` for org-wide coverage.
