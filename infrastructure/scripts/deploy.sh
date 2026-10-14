#!/usr/bin/env bash
# Deploys the agent runtime stack.
#
# Any extra arguments go through to `cdk deploy`, so context overrides work:
#   ./scripts/deploy.sh -c instanceType=t4g.large
#
# Approval is left at CDK's default (`broadening`): a change that widens a
# security group or an IAM policy stops and asks. That is the one prompt worth
# keeping, so this script does not pass --require-approval never.
set -euo pipefail

cd "$(dirname "$0")/.."

command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 1; }

region="${AWS_REGION:-$(aws configure get region)}"
echo "Account: $(aws sts get-caller-identity --query Account --output text)"
echo "Region:  ${region}"
echo

echo "==> Changes"
npx cdk diff "$@"

echo
read -rp "Deploy these changes? (y/N) " reply
case "${reply}" in
  y | Y) ;;
  *)
    echo "Cancelled."
    exit 0
    ;;
esac

npx cdk deploy --progress events "$@"
