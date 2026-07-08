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
  PR's mergeability. Its output is a checked-in snapshot (`CONFORMANCE.md`) —
  the dry run.
- **gate** — enforces. Exits non-zero (or fails the CI step) the moment it
  finds something wrong. Answers "can this merge?"

| script / workflow | mode | exits 1 on... |
|---|:-:|---|
| `scripts/audit.mjs` | audit | never — always exits 0 |
| `scripts/open-prs.sh` | audit | never — a digest, not a check |
| `scripts/gate/gate.ts` (`conformance-gate.yml`) | gate | descriptor or surface drift |
| `spell-gate.yml` (cspell) | gate | any token outside the dictionary/allowlist |
| `scripts/apply-rulesets.sh` | *(mutator — not audit or gate; it writes org settings)* | — |
| `scripts/apply-actions-policy.sh` | *(mutator — unions the org Actions allowlist; only widens)* | — |

## The standard

[`rulesets/default-branch.json`](rulesets/default-branch.json) — the default branch
of every repo should: require a **PR** before merge, a **linear history**, **signed
commits**, and forbid **force-push** and **deletion**. (Mirrors the ruleset already
on `.github`, generalized org-wide.)

It is the single source of truth: edit the JSON, run `scripts/apply-rulesets.sh`,
review in [org settings → Rules](https://github.com/organizations/bounded-systems/settings/rules).
No hand-clicking the UI.

## The Actions allowlist

The **second** org setting managed as code (same principle — no UI clicking):
GitHub's "Allow select actions" policy. [`actions-policy.json`](actions-policy.json)
lists the third-party actions the org **standard** requires — the ones
`bounded-systems/.github`'s `repo-standard.yml` references but that aren't
github-owned or verified-creator (`ossf/scorecard-action`, `anchore/sbom-action`).

> **Currently inert.** The org is on `allowed_actions: all` (every action already
> permitted), so there is no allowlist to enforce and this changes nothing today.
> It's **groundwork for the enforcement epic ([conformance#7](https://github.com/bounded-systems/conformance/issues/7))**:
> tightening the org to a curated "select actions" allowlist is a real future
> hardening, and when that happens this is the reviewed, version-controlled source
> for the required patterns — no UI clicking. It is **not** the fix for any current
> `startup_failure`: the spell-gate breakage in [`.github#55`](https://github.com/bounded-systems/.github/issues/55)
> turned out to be a permission-escalation bug in `repo-standard.yml`, unrelated to
> the allowlist (the org allows all actions).

[`scripts/apply-actions-policy.sh`](scripts/apply-actions-policy.sh) applies it
(org-admin token, like `apply-rulesets.sh`) — but **safely**: it *unions*
`requiredPatterns` into the live allowlist, never removing a pattern it doesn't
know about and never changing the `allowed_actions` mode. So while the org is on
`all` it's a no-op, and once on `select` it can only widen the allowlist, never
break a repo's CI. `DRY_RUN=1` prints the diff. Adding a pattern is a reviewed
diff — that's the gate.

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

## Cross-repo overlap → moved to `trellis`

Cross-repo structural overlap (is the same *structure* copy-pasted across repos
that should share a package?) used to live here as a fourth axis. It now lives in
[`trellis`](https://github.com/bounded-systems/trellis) (`check/overlap.ts`),
where the cross-repo relationship model already is. The check is the same — jscpd
clone discovery + the ast-grep rules that guard the `@bounded-systems/drift-gate`
consolidation boundary — but the *sanction* is no longer a bespoke allowlist: a
clone is legitimate iff trellis's lattice already joins the two repos by a
shared-code contract (`vendored-pin` / `shared-schema` / `import-boundary`). The
registry + catalog are the allowlist. An overlap check belongs there because it
is inherently *cross*-repo, not a per-repo governance measure like the checks
below.

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
- `actions-policy.json` — the org Actions allowlist floor (required third-party actions).
- `scripts/apply-actions-policy.sh` — union those patterns into the live org allowlist (safe; only widens).
- `scripts/audit.mjs` — score every repo; writes `CONFORMANCE.md`.
- `scripts/gate/` — the cross-repo drift gate (Deno); thin glue over
  `@bounded-systems/drift-gate`; `deno task gate`.
- `goldens/` — checked-in surface snapshots the gate diffs against.
- `gate.config.json` — what the gate points at (guest-room location).
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
