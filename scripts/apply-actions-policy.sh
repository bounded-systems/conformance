#!/usr/bin/env bash
# Ensure the org's "Allow select actions" allowlist contains every pattern in
# actions-policy.json → requiredPatterns — the third-party actions the org
# standard needs. Governance-as-code for the org Actions policy, the same way
# apply-rulesets.sh manages org rulesets. Needs an org-admin token (the
# `administration` org permission), same as apply-rulesets.sh.
#
# SAFE BY DESIGN — read-modify-write UNION:
#   * only ADDS patterns; never removes one it doesn't know about (a blind PUT of
#     selected-actions would replace the whole list and break every repo's CI).
#   * never changes the `allowed_actions` MODE. If the org isn't on "selected"
#     (i.e. it's "all" or "local_only"), there's no allowlist to enforce and this
#     exits without touching anything — switching modes is a separate, deliberate
#     decision, not a side effect of adding a pattern.
#
#   ./scripts/apply-actions-policy.sh            # apply (union) to the live org policy
#   DRY_RUN=1 ./scripts/apply-actions-policy.sh  # print the diff, change nothing
#   ORG=bounded-systems ./scripts/apply-actions-policy.sh
set -euo pipefail
ORG="${ORG:-bounded-systems}"
here="$(cd "$(dirname "$0")/.." && pwd)"
cfg="$here/actions-policy.json"

mapfile -t required < <(jq -r '.requiredPatterns[]' "$cfg")
[ "${#required[@]}" -gt 0 ] || { echo "no requiredPatterns in $cfg — nothing to do"; exit 0; }

mode="$(gh api "orgs/$ORG/actions/permissions" --jq '.allowed_actions')"
echo "org allowed_actions mode: $mode"
if [ "$mode" != "selected" ]; then
  echo "→ not on 'selected' — no allowlist to enforce; leaving policy unchanged."
  echo "  (every action is already permitted under '$mode'; switching to 'selected'"
  echo "   is a separate, deliberate tightening, not this script's job.)"
  exit 0
fi

# Current allowlist (the whole selected-actions payload — preserve it).
current="$(gh api "orgs/$ORG/actions/permissions/selected-actions")"
mapfile -t live < <(jq -r '.patterns_allowed[]?' <<<"$current")

missing=()
for p in "${required[@]}"; do
  found=0
  for l in "${live[@]}"; do [ "$l" = "$p" ] && found=1 && break; done
  [ "$found" -eq 0 ] && missing+=("$p")
done

if [ "${#missing[@]}" -eq 0 ]; then
  echo "✓ all required patterns already allowed — no change."
  exit 0
fi
echo "patterns to ADD (union — nothing is removed):"
printf '  + %s\n' "${missing[@]}"

# Merge: live ∪ required, preserving github_owned_allowed + verified_allowed.
payload="$(jq \
  --argjson add "$(printf '%s\n' "${missing[@]}" | jq -R . | jq -s .)" \
  '{github_owned_allowed, verified_allowed,
    patterns_allowed: ((.patterns_allowed // []) + $add | unique)}' \
  <<<"$current")"

if [ -n "${DRY_RUN:-}" ]; then
  echo "--- DRY_RUN: would PUT selected-actions ---"
  jq . <<<"$payload"
  exit 0
fi

gh api --method PUT "orgs/$ORG/actions/permissions/selected-actions" --input - <<<"$payload" >/dev/null
echo "✓ applied — review at https://github.com/organizations/$ORG/settings/actions"
