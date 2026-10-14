#!/usr/bin/env bash
# One-time preparation of an AWS account for this stack:
#   1. bootstrap the CDK toolkit in the target region
#   2. create the three SecureString parameters the runtime reads at start
#
# The parameter values are deliberately not in CloudFormation or in CDK
# context. They are typed in here, encrypted by Parameter Store, and read by
# the instance role at runtime.
#
# Usage: ./scripts/bootstrap.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PARAM_PREFIX="${MULTICA_PARAM_PREFIX:-/multica/agent-runtime}"

command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 1; }
command -v npx >/dev/null || { echo "Node.js (npx) is required" >&2; exit 1; }

account="$(aws sts get-caller-identity --query Account --output text)"
region="${AWS_REGION:-$(aws configure get region)}"
if [ -z "${region}" ]; then
  echo "No region configured. Set AWS_REGION or run 'aws configure'." >&2
  exit 1
fi

echo "Account: ${account}"
echo "Region:  ${region}"
echo

echo "==> Bootstrapping the CDK toolkit"
npx cdk bootstrap "aws://${account}/${region}"

put_parameter() {
  local name="$1" description="$2" value
  local path="${PARAM_PREFIX}/${name}"

  if aws ssm get-parameter --region "${region}" --name "${path}" >/dev/null 2>&1; then
    echo "==> ${path} already exists, leaving it alone"
    return
  fi

  echo
  echo "==> ${path}"
  echo "    ${description}"
  read -rsp "    Value (input hidden): " value
  echo
  if [ -z "${value}" ]; then
    echo "    Empty value; the daemon will not start without it." >&2
    exit 1
  fi
  aws ssm put-parameter --region "${region}" --name "${path}" --type SecureString --value "${value}" >/dev/null
  echo "    stored"
}

put_parameter multica-token \
  "Multica personal access token (mul_...), from https://multica.ai/settings?tab=tokens"
put_parameter claude-oauth-token \
  "Claude subscription token, from 'claude setup-token' on a signed-in machine"
put_parameter github-token \
  "GitHub token limited to the agents' repositories (fine-grained PAT or App installation token)"

echo
echo "Done. Deploy with ./scripts/deploy.sh"
