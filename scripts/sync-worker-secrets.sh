#!/usr/bin/env bash
# Push dashboard Worker secrets from Infisical (njmtech-clipping, prod) to Cloudflare. Values are never printed.
#   ACCESS_TEAM_DOMAIN, ACCESS_AUD   (Cloudflare Access verification)
#   INTERNAL_API_TOKEN  ← CLIPPER_API_TOKEN
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY ← DASHBOARD_AWS_* (IAM user clipper-dashboard: Batch submit/describe + job log reads)
#   YT_CLIENT_ID / YT_CLIENT_SECRET  (Google OAuth web client; the channel is connected in the dashboard)
#   TOKEN_ENC_KEY, TIKTOK_CLIENT_KEY/SECRET, META_APP_ID/SECRET/CONFIG_ID, R2_* (TikTok + Instagram publishing)
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
  put META_APP_ID "${META_APP_ID:-}"
  put META_APP_SECRET "${META_APP_SECRET:-}"
  put META_CONFIG_ID "${META_CONFIG_ID:-}"
  put R2_ACCOUNT_ID "${R2_ACCOUNT_ID:-}"
  put R2_ACCESS_KEY_ID "${R2_ACCESS_KEY_ID:-}"
  put R2_SECRET_ACCESS_KEY "${R2_SECRET_ACCESS_KEY:-}"
  put TURNSTILE_SITE_KEY "${TURNSTILE_SITE_KEY:-}"
  put TURNSTILE_SECRET_KEY "${TURNSTILE_SECRET_KEY:-}"
  put CF_API_TOKEN "${CF_API_TOKEN:-}"
  put CF_ACCOUNT_ID "${CLOUDFLARE_ACCOUNT_ID:-}"
  put CF_ACCESS_GROUP_ID "${CF_ACCESS_GROUP_ID:-}"
'
