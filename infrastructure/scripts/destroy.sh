#!/usr/bin/env bash
# Tears the runtime machine down.
#
# What this removes: the instance, its VPC, the IAM role and the log group.
# What it keeps: the SSM parameters, which are not CloudFormation resources.
# Delete those by hand if the account is being retired.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "This destroys the agent runtime machine. In-flight agent runs are lost;"
echo "the issues they were working on stay in Multica and can be reassigned."
echo
read -rp "Type 'destroy' to continue: " reply
if [ "${reply}" != "destroy" ]; then
  echo "Cancelled."
  exit 0
fi

npx cdk destroy "$@"

echo
echo "The SSM parameters under /multica/agent-runtime were left in place."
