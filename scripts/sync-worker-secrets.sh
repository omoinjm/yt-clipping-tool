#!/usr/bin/env bash
# Push dashboard Worker secrets from Infisical (njmtech-clipping, prod) to Cloudflare. Values are never printed.
#   INTERNAL_API_TOKEN  ← CLIPPER_API_TOKEN
#   YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN  (if present in Infisical)
set -euo pipefail
cd "$(dirname "$0")/../dashboard"
ENV=${INFISICAL_ENV:-prod}
infisical run --env "$ENV" --silent -- bash -c '
  put() { [ -n "${2:-}" ] && printf "%s" "$2" | npx wrangler secret put "$1" >/dev/null && echo "✓ $1" || echo "· $1 (not in Infisical, skipped)"; }
  put INTERNAL_API_TOKEN "${CLIPPER_API_TOKEN:-}"
  put YT_CLIENT_ID "${YT_CLIENT_ID:-}"
  put YT_CLIENT_SECRET "${YT_CLIENT_SECRET:-}"
  put YT_REFRESH_TOKEN "${YT_REFRESH_TOKEN:-}"
'
