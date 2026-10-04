#!/bin/bash

# AWS CDK Bootstrap Script for Multica Infrastructure
# This script bootstraps the AWS CDK toolkit in your AWS account

set -e

echo "======================================"
echo "AWS CDK Bootstrap for Multica"
echo "======================================"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed. Please install it first."
    echo "Visit: https://aws.amazon.com/cli/"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install Node.js 22 or higher."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "Error: Node.js version 22 or higher is required. Current version: $(node -v)"
    exit 1
fi

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    echo "CDK CLI not found. Installing..."
    npm install -g aws-cdk
fi

# Get AWS account and region
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-$(aws configure get region)}

if [ -z "$REGION" ]; then
    echo "Error: AWS region not set. Please set AWS_REGION environment variable or configure AWS CLI."
    exit 1
fi

echo "AWS Account: $ACCOUNT"
echo "AWS Region: $REGION"
echo ""

# Confirm before proceeding
read -p "Bootstrap CDK in this account and region? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Bootstrap cancelled."
    exit 0
fi

# Install dependencies
echo ""
echo "Installing dependencies..."
cd "$(dirname "$0")/.."
npm install

# Bootstrap CDK
echo ""
echo "Bootstrapping AWS CDK..."
cdk bootstrap aws://$ACCOUNT/$REGION

echo ""
echo "======================================"
echo "Bootstrap completed successfully!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Review and update infrastructure/lib/config.ts for your environment"
echo "2. Run 'npm run cdk:synth' to synthesize CloudFormation templates"
echo "3. Run 'npm run deploy:dev' to deploy to development environment"
echo ""
