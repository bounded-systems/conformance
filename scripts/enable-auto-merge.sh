#!/usr/bin/env bash
# Enable GitHub's auto-merge feature on every (non-archived, non-fork) org repo.
#
# Auto-merge lets a PR merge itself the moment its REQUIRED checks pass. It only
# does anything where the default branch actually has a required check to wait
# for — so pair this with an ACTIVE ruleset that requires one. Use
# `required-baseline.json` (the shared workflow) for that; do NOT reach for
# `default-branch.json` yet — its `required_signatures` rule rejects every
# unsigned bot/CI push to main (fleet board, publishers, mint), which is the
# blast radius the rollout notes warn about.
#
# After running this + activating a required-check ruleset, enable per PR with:
#   gh pr merge <n> --auto --squash
#
#   ./scripts/enable-auto-merge.sh            # all non-archived, non-fork repos
#   ORG=bounded-systems ./scripts/enable-auto-merge.sh
#   REPOS="drift-gate conformance trellis" ./scripts/enable-auto-merge.sh   # a subset
set -euo pipefail
ORG="${ORG:-bounded-systems}"

repos="${REPOS:-$(gh api "orgs/$ORG/repos?per_page=100" --paginate \
  --jq '.[] | select(.archived==false and .fork==false) | .name')}"

for repo in $repos; do
  if gh api --method PATCH "repos/$ORG/$repo" \
       -F allow_auto_merge=true -F allow_update_branch=true >/dev/null 2>&1; then
    echo "✓ $repo — auto-merge enabled"
  else
    echo "✗ $repo — failed (needs admin on the repo)"
  fi
done
echo "Done. Enable per-PR with: gh pr merge <n> --auto --squash"
