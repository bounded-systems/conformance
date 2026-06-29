#!/usr/bin/env bash
# Apply (create or update) the org rulesets in rulesets/*.json from this repo —
# the single source of truth. Reproducible: edit the JSON, re-run, review in the
# org settings UI. Starts `enforcement: "disabled"` (defined, inert) by design;
# flip to "active" in the JSON only after the audit shows the spread is acceptable.
#
#   ./scripts/apply-rulesets.sh            # apply all rulesets/*.json
#   ORG=bounded-systems ./scripts/apply-rulesets.sh
set -euo pipefail
ORG="${ORG:-bounded-systems}"
here="$(cd "$(dirname "$0")/.." && pwd)"

for f in "$here"/rulesets/*.json; do
  name="$(jq -r '.name' "$f")"
  # Find an existing org ruleset with this name → update; else create.
  id="$(gh api "orgs/$ORG/rulesets" --jq ".[] | select(.name==\"$name\") | .id" 2>/dev/null | head -1)"
  if [ -n "$id" ]; then
    echo "→ updating org ruleset '$name' (id $id)"
    gh api --method PUT "orgs/$ORG/rulesets/$id" --input "$f" >/dev/null
  else
    echo "→ creating org ruleset '$name'"
    gh api --method POST "orgs/$ORG/rulesets" --input "$f" >/dev/null
  fi
  echo "  enforcement: $(jq -r '.enforcement' "$f")"
done
echo "✓ rulesets applied — review at https://github.com/organizations/$ORG/settings/rules"
