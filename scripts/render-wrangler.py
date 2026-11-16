#!/usr/bin/env python3
"""Render dashboard/wrangler.jsonc from wrangler.template.jsonc using ${VAR}s from the environment.

Locally scripts/dashboard.sh runs this under `infisical run`; in Cloudflare Workers Builds it is the
build command, with CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID set as build variables.
"""
import os
import pathlib
import re

dash = pathlib.Path(__file__).resolve().parent.parent / "dashboard"
tpl = (dash / "wrangler.template.jsonc").read_text()
missing = sorted({m for m in re.findall(r"\$\{([A-Z0-9_]+)\}", tpl) if not os.environ.get(m)})
if missing:
    raise SystemExit(f"render-wrangler: missing env vars: {missing}")
out = re.sub(r"\$\{([A-Z0-9_]+)\}", lambda m: os.environ[m.group(1)], tpl)
(dash / "wrangler.jsonc").write_text(
    out.replace("// TEMPLATE: tracked in git", "// GENERATED: do not edit or commit", 1)
)
print("rendered dashboard/wrangler.jsonc")
