# conformance

**Org/repo conformance as code.** The standard every bounded-systems repo should
meet — defined as version-controlled rulesets — plus an audit that scores every
repo against it. This is the *repo/governance* conformance layer:

| layer | concern | home |
|---|---|---|
| [conformance-kit](https://github.com/bounded-systems/conformance-kit) | does a **site's content** conform? (a11y, SEO, SHACL, provenance) | `conformance-kit` |
| **this repo** | does a **repo** meet the org governance standard? (branch rules, signing) | `conformance` |
| [fleet](https://github.com/bounded-systems/fleet) | is a repo's CI **green right now**? | `fleet` |

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
reports) on drift:

- **descriptor** — every `descriptor.proof.claims[]` in guest-room's
  `trellis.json` names a `provenBy` file that exists, and that file's git blob
  hash matches the pin in guest-room's generated README claims table. This is the
  external, org-level twin of the `descriptor-kit` check guest-room runs on
  itself — enforced from here; the product repo is never wired to this gate.
- **surface** — guest-room `mod.ts`'s exported symbols (`deno doc --json`,
  normalized) match the checked-in golden
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
`contents: read` — no org-admin token. Deno is pinned (see `gate.config.json` →
`deno.pinnedInCI`) because the surface check diffs `deno doc` JSON, whose schema
can shift across deno versions; a deno bump means regenerating the golden.

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
- `scripts/gate/` — the cross-repo drift gate (Deno); `deno task gate`.
- `goldens/` — checked-in surface snapshots the gate diffs against.
- `gate.config.json` — what the gate points at (guest-room location, pinned deno).
- `deno.json` — gate task runners (`gate`, `gate:descriptor`, `gate:surface`, `surface:update`).
- `.github/workflows/conformance-gate.yml` — runs the gate on PR + daily schedule.
- `scripts/open-prs.sh` — org-level open-PR digest; writes `OPEN-PRS.md`.
- `cspell.json` — the spell-gate dictionary + project word allowlist.

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

## Spell gate

`spell-gate.yml` runs [`cspell`](https://cspell.org): CI **fails on any token not
in the English/software dictionaries or the `words` allowlist in `cspell.json`**.
This catches nonsense and promotional insertions *proactively* — a smuggled
product name isn't a word, so it fails unless someone adds it to the allowlist,
which is a **reviewed diff** (the gate: a reviewer sees new dictionary entries and
can reject a brand insertion). Keep `words` sorted, real project/tech terms only.
Intended to move into `repo-standard.yml` for org-wide coverage.
