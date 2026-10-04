#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { BackendStack } from '../lib/backend-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { getConfig } from '../lib/config';

const app = new cdk.App();

// Get environment from context (dev, staging, prod)
const environment = app.node.tryGetContext('environment') || 'dev';
const config = getConfig(environment);

// AWS account and region from environment variables or default
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1',
};

// Add environment tags to all stacks
const tags = {
  Environment: environment,
  Application: 'Multica',
  ManagedBy: 'CDK',
};

// Network Stack - VPC, Subnets, NAT, IGW
const networkStack = new NetworkStack(app, `Multica-Network-${environment}`, {
  env,
  description: `Multica Network Infrastructure (${environment})`,
  config,
});

// Database Stack - RDS PostgreSQL
const databaseStack = new DatabaseStack(app, `Multica-Database-${environment}`, {
  env,
  description: `Multica Database Infrastructure (${environment})`,
  vpc: networkStack.vpc,
  config,
});

// Backend Stack - EC2 with Auto Scaling for Go server
const backendStack = new BackendStack(app, `Multica-Backend-${environment}`, {
  env,
  description: `Multica Backend Infrastructure (${environment})`,
  vpc: networkStack.vpc,
  database: databaseStack.database,
  config,
});

// Frontend Stack - S3 + CloudFront for Next.js app
const frontendStack = new FrontendStack(app, `Multica-Frontend-${environment}`, {
  env,
  description: `Multica Frontend Infrastructure (${environment})`,
  config,
  backendUrl: backendStack.backendUrl,
});

// Add tags to all stacks
Object.entries(tags).forEach(([key, value]) => {
  cdk.Tags.of(networkStack).add(key, value);
  cdk.Tags.of(databaseStack).add(key, value);
  cdk.Tags.of(backendStack).add(key, value);
  cdk.Tags.of(frontendStack).add(key, value);
});

app.synth();
