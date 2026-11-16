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
python3 - <<"PY"
import os, re, pathlib
tpl = pathlib.Path("dashboard/wrangler.template.jsonc").read_text()
missing = sorted({m for m in re.findall(r"\$\{([A-Z0-9_]+)\}", tpl) if not os.environ.get(m)})
if missing:
    raise SystemExit(f"missing in Infisical: {missing}")
out = re.sub(r"\$\{([A-Z0-9_]+)\}", lambda m: os.environ[m.group(1)], tpl)
pathlib.Path("dashboard/wrangler.jsonc").write_text(out.replace("// TEMPLATE: tracked in git", "// GENERATED: do not edit or commit", 1))
PY
cd dashboard
export CLOUDFLARE_ACCOUNT_ID
case "$0" in
  render) echo "rendered dashboard/wrangler.jsonc" ;;
  deploy) npx wrangler deploy ;;
  dev) npx wrangler dev "$@" ;;
  migrate) npx wrangler d1 migrations apply clipper --remote ;;
  *) npx wrangler "$0" "$@" ;;
esac
' "$cmd" "$@"
