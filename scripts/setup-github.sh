#!/usr/bin/env bash
# One-time GitHub repository setup: merge settings, security features and the ruleset on main
# (PR only, required checks ci + codeql, no force push, no deletion). Requires `gh auth login`
# with admin rights on the repository. Run it after the first PR has created the check names.
set -euo pipefail

repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "Configuring $repo"

gh api -X PATCH "repos/$repo" \
  -F allow_auto_merge=true \
  -F delete_branch_on_merge=true \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false >/dev/null

gh api -X PUT "repos/$repo/vulnerability-alerts" >/dev/null
gh api -X PUT "repos/$repo/automated-security-fixes" >/dev/null
gh api -X PATCH "repos/$repo" --input - >/dev/null <<'JSON'
{ "security_and_analysis": { "secret_scanning": { "status": "enabled" }, "secret_scanning_push_protection": { "status": "enabled" } } }
JSON

existing=$(gh api "repos/$repo/rulesets" -q '.[] | select(.name=="main") | .id' || true)
method=POST
path="repos/$repo/rulesets"
if [[ -n "$existing" ]]; then method=PUT; path="repos/$repo/rulesets/$existing"; fi

gh api -X "$method" "$path" --input - >/dev/null <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "ci" }, { "context": "codeql" }]
      }
    }
  ]
}
JSON

echo "Done. Remaining manual steps (secrets, variables) are listed in docs/SETUP.md."
