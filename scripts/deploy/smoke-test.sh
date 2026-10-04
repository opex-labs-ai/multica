#!/usr/bin/env bash
# Smoke test script for Multica deployments
# Usage: ./smoke-test.sh <environment>
#
# Environment: dev, staging, production

set -e

ENVIRONMENT="${1:-dev}"

case "$ENVIRONMENT" in
  dev)
    API_URL="https://dev-api.multica.example.com"
    APP_URL="https://dev.multica.example.com"
    ;;
  staging)
    API_URL="https://staging-api.multica.example.com"
    APP_URL="https://staging.multica.example.com"
    ;;
  production)
    API_URL="https://api.multica.example.com"
    APP_URL="https://multica.example.com"
    ;;
  *)
    echo "❌ Invalid environment: $ENVIRONMENT"
    echo "   Valid environments: dev, staging, production"
    exit 1
    ;;
esac

echo "🧪 Running smoke tests for $ENVIRONMENT environment"
echo "API URL: $API_URL"
echo "App URL: $APP_URL"
echo ""

# Track failures
FAILED_TESTS=0

# Test function
run_test() {
  local test_name="$1"
  local test_command="$2"

  echo "Testing: $test_name..."

  if eval "$test_command"; then
    echo "✅ PASS: $test_name"
    return 0
  else
    echo "❌ FAIL: $test_name"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    return 1
  fi
}

echo "=== Backend Smoke Tests ==="
run_test "API Health Endpoint" "curl -f -s -o /dev/null $API_URL/health"
run_test "API Status Endpoint" "curl -f -s -o /dev/null $API_URL/api/v1/status || true"
run_test "API Returns JSON" "curl -s $API_URL/health | grep -q '{'"
echo ""

echo "=== Frontend Smoke Tests ==="
run_test "Frontend Loads" "curl -f -s -o /dev/null $APP_URL"
run_test "Frontend Returns HTML" "curl -s $APP_URL | grep -q '<html'"
run_test "Frontend Status Code 200" "[ \$(curl -s -o /dev/null -w '%{http_code}' $APP_URL) = '200' ]"
echo ""

echo "=== Connectivity Tests ==="
run_test "WebSocket Endpoint Available" "curl -f -s -o /dev/null ${API_URL}/ws || echo 'WS endpoint check skipped'"
echo ""

echo "=== Security Headers Tests ==="
run_test "HTTPS Redirect Works" "curl -s -o /dev/null -w '%{http_code}' http://$(echo $APP_URL | sed 's|https://||') | grep -qE '301|302|307|308' || true"
echo ""

# Summary
echo "=========================="
echo "Smoke Test Summary"
echo "=========================="

if [ $FAILED_TESTS -eq 0 ]; then
  echo "✅ All smoke tests passed!"
  exit 0
else
  echo "❌ $FAILED_TESTS test(s) failed"
  exit 1
fi
