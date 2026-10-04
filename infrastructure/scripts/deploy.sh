#!/bin/bash

# Deployment script for Multica infrastructure (Development environment)
# Usage: ./deploy.sh

set -e

ENVIRONMENT="dev"

echo "======================================"
echo "Deploying Multica Infrastructure"
echo "Environment: Development"
echo "======================================"
echo ""

# Check prerequisites
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed"
    exit 1
fi

if ! command -v cdk &> /dev/null; then
    echo "Error: CDK CLI is not installed"
    echo "Install: npm install -g aws-cdk"
    exit 1
fi

# Get AWS account and region
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-$(aws configure get region)}

echo "AWS Account: $ACCOUNT"
echo "AWS Region: $REGION"
echo ""

# Confirm deployment
read -p "Deploy development infrastructure? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 0
fi

# Install/update dependencies
echo ""
echo "Installing dependencies..."
cd "$(dirname "$0")/.."
npm install

# Synthesize CDK app
echo ""
echo "Synthesizing CDK application..."
npm run synth

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
echo ""
echo "Estimated monthly cost: ~\$95"
echo ""
