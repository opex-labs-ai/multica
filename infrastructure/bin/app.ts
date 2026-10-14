#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { AgentRuntimeStack } from '../lib/agent-runtime-stack';
import { resolveConfig } from '../lib/config';

const app = new cdk.App();
const config = resolveConfig(app);

// Region and account come from the ambient AWS configuration. Both stay
// undefined when no credentials are present, which is what lets `cdk synth`
// run in CI: the template is then region-agnostic.
const stack = new AgentRuntimeStack(app, 'Multica-AgentRuntime', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION,
  },
  description: 'Shared machine that runs the Multica agent daemon and its Claude Code runtimes',
  config,
});

cdk.Tags.of(stack).add('Application', 'Multica');
cdk.Tags.of(stack).add('Component', 'AgentRuntime');
cdk.Tags.of(stack).add('ManagedBy', 'CDK');

app.synth();
