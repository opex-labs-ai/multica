#!/usr/bin/env bash
# Rollback script for Multica deployments
# Usage: ./rollback.sh <component> <previous-version> <instance-id>
#
# Components: backend, frontend
# Example: ./rollback.sh backend v1.2.3 i-1234567890abcdef0

set -e

COMPONENT="${1}"
PREVIOUS_VERSION="${2}"
INSTANCE_ID="${3}"
REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_REPO="${IMAGE_REPO:-opex-labs-ai/multica}"

if [ -z "$COMPONENT" ] || [ -z "$PREVIOUS_VERSION" ] || [ -z "$INSTANCE_ID" ]; then
  echo "❌ Usage: $0 <component> <previous-version> <instance-id>"
  echo "   Components: backend, frontend"
  echo "   Example: $0 backend v1.2.3 i-1234567890abcdef0"
  exit 1
fi

case "$COMPONENT" in
  backend)
    CONTAINER_NAME="multica-backend"
    IMAGE_NAME="$REGISTRY/$IMAGE_REPO/backend"
    PORT="8080"
    ;;
  frontend)
    CONTAINER_NAME="multica-web"
    IMAGE_NAME="$REGISTRY/$IMAGE_REPO/frontend"
    PORT="3000"
    ;;
  *)
    echo "❌ Invalid component: $COMPONENT"
    echo "   Valid components: backend, frontend"
    exit 1
    ;;
esac

echo "🔄 Rolling back $COMPONENT to version $PREVIOUS_VERSION"
echo "Instance: $INSTANCE_ID"
echo "Image: $IMAGE_NAME:$PREVIOUS_VERSION"

# Create SSM command to rollback
ROLLBACK_COMMAND=$(cat <<EOF
cd /opt/multica
echo "Stopping current container..."
docker stop $CONTAINER_NAME || true
docker rm $CONTAINER_NAME || true

echo "Pulling previous version..."
docker pull $IMAGE_NAME:$PREVIOUS_VERSION

echo "Starting container with previous version..."
docker run -d --name $CONTAINER_NAME \
  --restart unless-stopped \
  -p $PORT:$PORT \
  --env-file /opt/multica/.env \
  $IMAGE_NAME:$PREVIOUS_VERSION

echo "Rollback complete!"
docker ps | grep $CONTAINER_NAME
EOF
)

echo "Executing rollback via SSM..."
aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=['$ROLLBACK_COMMAND']" \
  --output text

echo "✅ Rollback command sent to instance $INSTANCE_ID"
echo "⏳ Waiting for deployment to stabilize..."
sleep 30

# Verify rollback
echo "🔍 Verifying rollback..."
HEALTH_URL="http://${INSTANCE_ID}:${PORT}/health"
if curl -f -s -o /dev/null "$HEALTH_URL"; then
  echo "✅ Rollback successful! $COMPONENT is healthy."
else
  echo "⚠️  Rollback completed but health check could not be verified."
  echo "   Please check the instance manually."
fi
