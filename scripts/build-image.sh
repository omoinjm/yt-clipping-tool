#!/usr/bin/env bash
# Zip the repo (only what the Dockerfile needs), send it to S3, and build the GPU image in CodeBuild.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK=${STACK:-Clipper}
out() { aws cloudformation describe-stacks --stack-name "$STACK" \
          --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET=$(out WorkBucketName)
PROJECT=$(out BuildProject)

ZIP=$(mktemp -d)/source.zip
python3 - "$ZIP" <<'PY'
import sys, zipfile, pathlib
paths = ["Dockerfile", "Dockerfile.render", ".dockerignore", "docker-entrypoint.sh", "pyproject.toml", "uv.lock", ".python-version", "README.md", "src",
         "remotion/package.json", "remotion/package-lock.json", "remotion/tsconfig.json",
         "remotion/remotion.config.ts", "remotion/render-job.mjs", "remotion/src"]
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for p in map(pathlib.Path, paths):
        for f in ([p] if p.is_file() else sorted(p.rglob("*"))):
            if f.is_file() and "__pycache__" not in f.parts:
                z.write(f, f.as_posix())
PY
aws s3 cp "$ZIP" "s3://$BUCKET/build/source.zip" --only-show-errors

BUILD_ID=$(aws codebuild start-build --project-name "$PROJECT" --query build.id --output text)
echo "CodeBuild started: $BUILD_ID"
while true; do
  STATUS=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].buildStatus' --output text)
  PHASE=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].currentPhase' --output text)
  echo "$(date +%H:%M:%S) $STATUS $PHASE"
  [[ "$STATUS" != "IN_PROGRESS" ]] && break
  sleep 30
done
[[ "$STATUS" == "SUCCEEDED" ]] || { echo "build failed; logs: aws logs tail --follow (CodeBuild log group)"; exit 1; }
