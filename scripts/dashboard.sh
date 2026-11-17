#!/usr/bin/env bash
# Render dashboard/wrangler.jsonc from the tracked template (IDs from Infisical), then run wrangler.
#   scripts/dashboard.sh deploy          # deploy the Worker
#   scripts/dashboard.sh dev             # local dev (wrangler dev)
#   scripts/dashboard.sh migrate         # apply D1 migrations (remote)
#   scripts/dashboard.sh render          # only write wrangler.jsonc
#   scripts/dashboard.sh <wrangler args> # anything else is passed to wrangler
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=${INFISICAL_ENV:-prod}
cmd=${1:-deploy}; shift || true
infisical run --env "$ENV" --silent -- bash -c '
set -euo pipefail
unset CF_API_TOKEN  # the Users-page token; wrangler would otherwise use it as its own login
python3 scripts/render-wrangler.py
cd dashboard
export CLOUDFLARE_ACCOUNT_ID
case "$0" in
  render) ;;
  deploy) npx wrangler deploy ;;
  dev) npx wrangler dev "$@" ;;
  migrate) npx wrangler d1 migrations apply clipper --remote ;;
  *) npx wrangler "$0" "$@" ;;
esac
' "$cmd" "$@"
