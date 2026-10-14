#!/usr/bin/env bash
# Opens a Session Manager shell on the runtime machine. There is no SSH path
# onto the box and no key pair, so this is the way in.
#
# Needs the Session Manager plugin for the AWS CLI:
# https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
#
# Usage: ./scripts/connect.sh
set -euo pipefail

STACK="${MULTICA_STACK:-Multica-AgentRuntime}"

region="${AWS_REGION:-$(aws configure get region)}"
instance="$(aws cloudformation describe-stacks \
  --region "${region}" \
  --stack-name "${STACK}" \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" \
  --output text)"

if [ -z "${instance}" ] || [ "${instance}" = "None" ]; then
  echo "Could not read InstanceId from stack ${STACK} in ${region}." >&2
  exit 1
fi

echo "Connecting to ${instance}. Useful once inside:"
echo "  sudo systemctl status multica-daemon"
echo "  sudo tail -f /var/log/multica/daemon.log"
echo "  sudo cloud-init status --long          # bootstrap result"
echo
exec aws ssm start-session --region "${region}" --target "${instance}"
