#!/usr/bin/env bash
# Push dashboard Worker secrets from Infisical (njmtech-clipping, prod) to Cloudflare. Values are never printed.
#   ACCESS_TEAM_DOMAIN, ACCESS_AUD   (Cloudflare Access verification)
#   INTERNAL_API_TOKEN  ← CLIPPER_API_TOKEN
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY ← DASHBOARD_AWS_* (IAM user clipper-dashboard: Batch submit/describe + job log reads)
#   YT_CLIENT_ID / YT_CLIENT_SECRET  (Google OAuth web client; the channel is connected in the dashboard)
#   TOKEN_ENC_KEY, TIKTOK_CLIENT_KEY/SECRET, IG_APP_ID/SECRET, R2_* (TikTok + Instagram publishing)
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
  put TOKEN_ENC_KEY "${TOKEN_ENC_KEY:-}"
  put TIKTOK_CLIENT_KEY "${TIKTOK_CLIENT_KEY:-}"
  put TIKTOK_CLIENT_SECRET "${TIKTOK_CLIENT_SECRET:-}"
  put IG_APP_ID "${IG_APP_ID:-}"
  put IG_APP_SECRET "${IG_APP_SECRET:-}"
  put R2_ACCOUNT_ID "${R2_ACCOUNT_ID:-}"
  put R2_ACCESS_KEY_ID "${R2_ACCESS_KEY_ID:-}"
  put R2_SECRET_ACCESS_KEY "${R2_SECRET_ACCESS_KEY:-}"
'
