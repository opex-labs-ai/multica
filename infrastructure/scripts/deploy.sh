#!/bin/bash

# Deployment script for Multica infrastructure
# Usage: ./deploy.sh <environment>
# Example: ./deploy.sh dev

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
echo "Deploying Multica Infrastructure"
echo "Environment: $ENVIRONMENT"
echo "======================================"
echo ""

# Check prerequisites
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed"
    exit 1
fi

if ! command -v cdk &> /dev/null; then
    echo "Error: CDK CLI is not installed"
    exit 1
fi

# Get AWS account and region
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-$(aws configure get region)}

echo "AWS Account: $ACCOUNT"
echo "AWS Region: $REGION"
echo ""

# Confirm deployment
if [ "$ENVIRONMENT" = "prod" ]; then
    echo "⚠️  WARNING: You are about to deploy to PRODUCTION!"
    echo ""
    read -p "Are you sure you want to continue? Type 'yes' to proceed: " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "Deployment cancelled."
        exit 0
    fi
else
    read -p "Deploy to $ENVIRONMENT? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Deployment cancelled."
        exit 0
    fi
fi

# Install/update dependencies
echo ""
echo "Installing dependencies..."
cd "$(dirname "$0")/.."
npm install

# Synthesize CDK app
echo ""
echo "Synthesizing CDK application..."
npm run cdk:synth -- --context environment=$ENVIRONMENT

# Deploy all stacks
echo ""
echo "Deploying stacks..."
cdk deploy --all \
    --context environment=$ENVIRONMENT \
    --require-approval never \
    --progress events

echo ""
echo "======================================"
echo "Deployment completed successfully!"
echo "======================================"
echo ""
echo "Stack outputs have been displayed above."
echo "You can also view them in the AWS CloudFormation console."
echo ""
