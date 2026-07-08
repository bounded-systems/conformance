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
- `scripts/open-prs.sh` — org-level open-PR digest; writes `OPEN-PRS.md`.

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
