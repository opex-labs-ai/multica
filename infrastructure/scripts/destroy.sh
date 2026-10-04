#!/bin/bash

# Destroy script for Multica infrastructure
# Usage: ./destroy.sh <environment>
# Example: ./destroy.sh dev

set -e

ENVIRONMENT=${1:-dev}
VALID_ENVIRONMENTS="dev staging prod"

# Validate environment
if ! echo "$VALID_ENVIRONMENTS" | grep -w "$ENVIRONMENT" > /dev/null; then
    echo "Error: Invalid environment '$ENVIRONMENT'"
    echo "Valid environments: $VALID_ENVIRONMENTS"
    exit 1
fi

echo "======================================"
echo "⚠️  WARNING: DESTRUCTIVE OPERATION ⚠️"
echo "======================================"
echo ""
echo "This will DESTROY all infrastructure for:"
echo "Environment: $ENVIRONMENT"
echo ""

# Multiple confirmations for production
if [ "$ENVIRONMENT" = "prod" ]; then
    echo "🚨 YOU ARE ABOUT TO DESTROY PRODUCTION INFRASTRUCTURE! 🚨"
    echo ""
    read -p "Type the environment name '$ENVIRONMENT' to confirm: " CONFIRM1
    if [ "$CONFIRM1" != "$ENVIRONMENT" ]; then
        echo "Confirmation failed. Destruction cancelled."
        exit 0
    fi

    read -p "Type 'DESTROY' in capital letters to proceed: " CONFIRM2
    if [ "$CONFIRM2" != "DESTROY" ]; then
        echo "Confirmation failed. Destruction cancelled."
        exit 0
    fi
else
    read -p "Type 'yes' to confirm destruction: " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "Destruction cancelled."
        exit 0
    fi
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
