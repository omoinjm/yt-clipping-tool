#!/usr/bin/env bash
# Re-enable GPU processing after the cost guard stopped it.
set -euo pipefail
CE=$(aws batch describe-job-queues --job-queues clipper-gpu --query 'jobQueues[0].computeEnvironmentOrder[0].computeEnvironment' --output text)
aws batch update-compute-environment --compute-environment "$CE" --state ENABLED \
  --compute-resources minvCpus=0,maxvCpus=16 >/dev/null
aws batch update-job-queue --job-queue clipper-gpu --state ENABLED >/dev/null
echo "✓ GPU queue and compute environment re-enabled"
