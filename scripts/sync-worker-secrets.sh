#!/usr/bin/env bash
# Push dashboard Worker secrets from Infisical (njmtech-clipping, prod) to Cloudflare. Values are never printed.
#   ACCESS_TEAM_DOMAIN, ACCESS_AUD   (Cloudflare Access verification)
#   INTERNAL_API_TOKEN  ← CLIPPER_API_TOKEN
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY ← DASHBOARD_AWS_* (IAM user clipper-dashboard: batch:SubmitJob only)
#   YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN  (if present in Infisical)
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/dashboard.sh render >/dev/null
cd dashboard
ENV=${INFISICAL_ENV:-prod}
infisical run --env "$ENV" --silent -- bash -c '
  put() { [ -n "${2:-}" ] && printf "%s" "$2" | npx wrangler secret put "$1" >/dev/null && echo "✓ $1" || echo "· $1 (not in Infisical, skipped)"; }
  export CLOUDFLARE_ACCOUNT_ID
  put ACCESS_TEAM_DOMAIN "${ACCESS_TEAM_DOMAIN:-}"
  put ACCESS_AUD "${ACCESS_AUD:-}"
  put INTERNAL_API_TOKEN "${CLIPPER_API_TOKEN:-}"
  put AWS_ACCESS_KEY_ID "${DASHBOARD_AWS_ACCESS_KEY_ID:-}"
  put AWS_SECRET_ACCESS_KEY "${DASHBOARD_AWS_SECRET_ACCESS_KEY:-}"
  put YT_CLIENT_ID "${YT_CLIENT_ID:-}"
  put YT_CLIENT_SECRET "${YT_CLIENT_SECRET:-}"
  put YT_REFRESH_TOKEN "${YT_REFRESH_TOKEN:-}"
'
