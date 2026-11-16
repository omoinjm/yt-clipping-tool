#!/bin/sh
# Inject secrets from Infisical (machine identity, AWS IAM auth via the Batch job role), then run clipper.
# With INFISICAL_IDENTITY_ID unset, runs clipper with the environment as-is.
set -eu
if [ -n "${INFISICAL_IDENTITY_ID:-}" ]; then
  INFISICAL_TOKEN=$(infisical login --method=aws-iam --machine-identity-id="$INFISICAL_IDENTITY_ID" --plain --silent)
  export INFISICAL_TOKEN
  exec infisical run --projectId "$INFISICAL_PROJECT_ID" --env "${INFISICAL_ENV:-prod}" --silent -- clipper "$@"
fi
exec clipper "$@"
