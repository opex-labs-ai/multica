#!/bin/bash

# Destroy script for Multica infrastructure (Development environment)
# Usage: ./destroy.sh

set -e

ENVIRONMENT="dev"

echo "======================================"
echo "⚠️  WARNING: DESTRUCTIVE OPERATION ⚠️"
echo "======================================"
echo ""
echo "This will DESTROY all development infrastructure."
echo ""

read -p "Type 'yes' to confirm destruction: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Destruction cancelled."
    exit 0
fi

# Get AWS account and region
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-$(aws configure get region)}

echo ""
echo "AWS Account: $ACCOUNT"
echo "AWS Region: $REGION"
echo ""
echo "Proceeding with destruction in 5 seconds..."
sleep 5

# Destroy all stacks
cd "$(dirname "$0")/.."
cdk destroy --all \
    --context environment=$ENVIRONMENT \
    --force

echo ""
echo "======================================"
echo "Destruction completed."
echo "======================================"
echo ""
