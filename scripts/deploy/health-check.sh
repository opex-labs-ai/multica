#!/usr/bin/env bash
# Health check script for Multica deployments
# Usage: ./health-check.sh <api-url> [max-attempts] [delay-seconds]

set -e

API_URL="${1:-http://localhost:8080}"
MAX_ATTEMPTS="${2:-30}"
DELAY="${3:-10}"

echo "🔍 Running health check against: $API_URL"
echo "Max attempts: $MAX_ATTEMPTS, Delay: ${DELAY}s"

attempt=0
while [ $attempt -lt "$MAX_ATTEMPTS" ]; do
  attempt=$((attempt + 1))

  echo "Attempt $attempt/$MAX_ATTEMPTS..."

  # Try to hit the health endpoint
  if curl -f -s -o /dev/null "$API_URL/health"; then
    echo "✅ Health check passed!"
    echo "API is healthy at: $API_URL"
    exit 0
  fi

  if [ $attempt -lt "$MAX_ATTEMPTS" ]; then
    echo "⏳ Health check failed, waiting ${DELAY}s before retry..."
    sleep "$DELAY"
  fi
done

echo "❌ Health check failed after $MAX_ATTEMPTS attempts"
echo "API did not become healthy at: $API_URL"
exit 1
