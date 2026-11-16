#!/usr/bin/env bash
# Set one key in the AWS `clipper/runtime` secret without echoing the value.
# Usage: scripts/set-secret.sh ANTHROPIC_API_KEY
set -euo pipefail
KEY=${1:?usage: $0 KEY}
read -rsp "Value for $KEY: " VALUE; echo
python3 - "$KEY" "$VALUE" <<'PY'
import json, subprocess, sys
key, value = sys.argv[1], sys.argv[2]
cur = json.loads(subprocess.check_output(["aws", "secretsmanager", "get-secret-value", "--secret-id", "clipper/runtime",
                                          "--query", "SecretString", "--output", "text"]))
if key not in cur:
    sys.exit(f"unknown key {key}; expected one of {sorted(cur)}")
cur[key] = value
subprocess.check_call(["aws", "secretsmanager", "put-secret-value", "--secret-id", "clipper/runtime",
                       "--secret-string", json.dumps(cur)], stdout=subprocess.DEVNULL)
print(f"✓ {key} updated; still unset: {[k for k, v in cur.items() if v == 'CHANGE_ME'] or 'none'}")
PY
