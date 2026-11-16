#!/usr/bin/env bash
# Delete EVERYTHING this project created in AWS (and optionally Cloudflare). Irreversible.
# Closing the AWS account itself must be done in the console afterwards (see the end of this script).
set -euo pipefail
cd "$(dirname "$0")/.."
REGION=${AWS_REGION:-eu-west-1}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "This permanently deletes the Clipper stack, S3 data, ECR images, logs, budget and CDK bootstrap"
echo "in AWS account $ACCOUNT ($REGION)."
[[ "${1:-}" == "--cloudflare" ]] && echo "It ALSO deletes the Cloudflare Worker, D1 database and R2 clips."
read -rp 'Type "delete everything" to continue: ' ok
[[ "$ok" == "delete everything" ]] || { echo "aborted"; exit 1; }

BUCKET=$(aws cloudformation describe-stacks --stack-name Clipper --query "Stacks[0].Outputs[?OutputKey=='WorkBucketName'].OutputValue" --output text 2>/dev/null || true)

echo "→ destroying Clipper stack"
(cd infra/aws && npx cdk destroy Clipper --force)

echo "→ deleting retained resources"
if [[ -n "$BUCKET" && "$BUCKET" != "None" ]]; then aws s3 rb "s3://$BUCKET" --force || true; fi
aws ecr delete-repository --repository-name clipper --force --region "$REGION" >/dev/null 2>&1 || true
for lg in $(aws logs describe-log-groups --region "$REGION" --query "logGroups[?starts_with(logGroupName,'/clipper') || contains(logGroupName,'Clipper') || contains(logGroupName,'clipper')].logGroupName" --output text); do
  aws logs delete-log-group --log-group-name "$lg" --region "$REGION" || true
done
aws budgets delete-budget --account-id "$ACCOUNT" --budget-name clipper-monthly 2>/dev/null || true

echo "→ removing CDK bootstrap"
ASSETS=$(aws cloudformation describe-stacks --stack-name CDKToolkit --region "$REGION" --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text 2>/dev/null || true)
if [[ -n "$ASSETS" && "$ASSETS" != "None" ]]; then aws s3 rb "s3://$ASSETS" --force || true; fi
for repo in $(aws ecr describe-repositories --region "$REGION" --query "repositories[?starts_with(repositoryName,'cdk-')].repositoryName" --output text); do
  aws ecr delete-repository --repository-name "$repo" --force --region "$REGION" >/dev/null || true
done
aws cloudformation delete-stack --stack-name CDKToolkit --region "$REGION"
aws cloudformation wait stack-delete-complete --stack-name CDKToolkit --region "$REGION" || true

if [[ "${1:-}" == "--cloudflare" ]]; then
  echo "→ deleting Cloudflare resources"
  (cd dashboard && npx wrangler delete --force || true
   npx wrangler d1 delete clipper -y || true
   npx wrangler r2 object list clipper-clips >/dev/null 2>&1 || true
   npx wrangler r2 bucket delete clipper-clips || echo "  R2 bucket not empty: empty it in the dashboard, then rerun this line")
fi

cat <<MSG

✓ AWS resources deleted.
To close the AWS account (console only, root user):
  1. Sign in as root → account menu (top right) → Account
  2. Scroll to "Close account" → confirm.
The account enters a 90-day post-closure period; any final charges are billed then.
Infisical project 'njmtech-clipping' and identity 'clipper-batch' can be deleted in the Infisical UI.
MSG
