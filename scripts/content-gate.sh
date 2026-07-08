#!/usr/bin/env bash
# content-gate.sh — fail CI when source contains disallowed content: promotional /
# third-party-branding insertions (e.g. a contributor naming test fixtures after
# their own product; verbspec #8, de-branded in #11).
#
# REACTIVE by design: the denylist in content-policy.json grows as offenders are
# caught. It stops re-introduction and copycats and acts as a regression guard;
# it will NOT catch a brand-new brand on first sight — human review of naming on
# external PRs is the primary defense. This backstops it.
#
#   bash scripts/content-gate.sh              # scan the working tree
#   bash scripts/content-gate.sh path/to/policy.json
# Requires: git, jq.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POLICY="${1:-$ROOT/content-policy.json}"
cd "$ROOT"

# Skip the policy + gate themselves and the GENERATED reports (they legitimately
# quote external PR titles, e.g. OPEN-PRS.md listing an offending PR).
EXCLUDES=(':!content-policy.json' ':!scripts/content-gate.sh'
          ':!OPEN-PRS.md' ':!CONFORMANCE.md' ':!*.lock' ':!*-lock.json')

fail=0
while IFS= read -r term; do
  [ -z "$term" ] && continue
  hits=$(git grep -In -i -e "$term" -- . "${EXCLUDES[@]}" 2>/dev/null) || true
  if [ -n "$hits" ]; then
    echo "✗ disallowed term \"$term\" (see content-policy.json):"
    printf '%s\n' "$hits" | sed 's/^/    /'
    fail=1
  fi
done < <(jq -r '.deny_terms[]' "$POLICY")

if [ "$fail" -ne 0 ]; then
  echo
  echo "content-gate: FAIL — remove the flagged content, or (if genuinely intended)"
  echo "               drop the term from content-policy.json in a reviewed PR."
  exit 1
fi
echo "content-gate: ✓ no disallowed content ($(jq '.deny_terms|length' "$POLICY") term(s) checked)"
