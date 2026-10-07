/**
 * Configuration for the Multica agent runtime machine.
 *
 * There is one environment on purpose. Multica itself runs on
 * https://multica.ai, so nothing here hosts the web app, the Go server, or a
 * database — this stack only provides the Linux box that runs the Multica
 * daemon and the Claude Code runtimes it registers.
 *
 * Every value is overridable through CDK context so a deploy can change the
 * shape of the machine without a code change:
 *
 *   cdk deploy -c instanceType=t4g.large -c natGateway=true
 */
import type { App } from 'aws-cdk-lib';

export interface AgentRuntimeConfig {
  /** EC2 instance type. Graviton only — the AMI is arm64. */
  instanceType: string;
  /** Root EBS volume size in GiB. Git checkouts plus node_modules add up. */
  volumeSizeGb: number;
  /**
   * When true the instance moves to a private subnet behind a NAT gateway.
   * Default false: the instance sits in a public subnet with no inbound rules
   * and reaches the internet directly, which saves the NAT gateway's ~$33/mo.
   * Either way there is no SSH and no listener — access is Session Manager.
   */
  natGateway: boolean;
  /** Multica API the daemon logs in to. */
  serverUrl: string;
  /** SSM Parameter Store prefix holding the runtime's credentials. */
  parameterPrefix: string;
  /** Multica CLI release tag, or 'latest' to resolve the newest release. */
  cliVersion: string;
  /** Node.js major version Claude Code runs on. */
  nodeMajorVersion: string;
  /** CloudWatch Logs retention in days. */
  logRetentionDays: number;
  /** MULTICA_DAEMON_MAX_CONCURRENT_TASKS for the daemon. */
  maxConcurrentTasks: number;
}

const defaults: AgentRuntimeConfig = {
  instanceType: 't4g.medium',
  volumeSizeGb: 40,
  natGateway: false,
  serverUrl: 'https://api.multica.ai',
  parameterPrefix: '/multica/agent-runtime',
  cliVersion: 'latest',
  nodeMajorVersion: '22',
  logRetentionDays: 14,
  maxConcurrentTasks: 4,
};

/**
 * Graviton instance families. The machine image is arm64, so an x86 instance
 * type would boot the wrong AMI architecture and fail at launch with a message
 * that does not say why. Reject it at synth instead.
 */
const GRAVITON_FAMILY = /^[a-z]+\d+g[a-z]*$/;

export function resolveConfig(app: App): AgentRuntimeConfig {
  const config: AgentRuntimeConfig = {
    instanceType: contextString(app, 'instanceType', defaults.instanceType),
    volumeSizeGb: contextNumber(app, 'volumeSizeGb', defaults.volumeSizeGb),
    natGateway: contextBoolean(app, 'natGateway', defaults.natGateway),
    serverUrl: contextString(app, 'serverUrl', defaults.serverUrl),
    parameterPrefix: contextString(app, 'parameterPrefix', defaults.parameterPrefix),
    cliVersion: contextString(app, 'cliVersion', defaults.cliVersion),
    nodeMajorVersion: contextString(app, 'nodeMajorVersion', defaults.nodeMajorVersion),
    logRetentionDays: contextNumber(app, 'logRetentionDays', defaults.logRetentionDays),
    maxConcurrentTasks: contextNumber(app, 'maxConcurrentTasks', defaults.maxConcurrentTasks),
  };

  const family = config.instanceType.split('.')[0] ?? '';
  if (!GRAVITON_FAMILY.test(family)) {
    throw new Error(
      `instanceType ${config.instanceType} is not a Graviton (arm64) type; the machine image is arm64. Use t4g/m7g/c7g/r7g or similar.`,
    );
  }
  if (!config.parameterPrefix.startsWith('/') || config.parameterPrefix.endsWith('/')) {
    throw new Error(`parameterPrefix must start with "/" and not end with one, got ${config.parameterPrefix}`);
  }
  if (!/^https:\/\//.test(config.serverUrl)) {
    throw new Error(`serverUrl must be https, got ${config.serverUrl}`);
  }
  if (config.volumeSizeGb < 20) {
    throw new Error(`volumeSizeGb must be at least 20, got ${config.volumeSizeGb}`);
  }
  if (config.maxConcurrentTasks < 1) {
    throw new Error(`maxConcurrentTasks must be at least 1, got ${config.maxConcurrentTasks}`);
  }
  return config;
}

function contextString(app: App, key: string, fallback: string): string {
  const value = app.node.tryGetContext(key);
  return value === undefined ? fallback : String(value);
}

function contextNumber(app: App, key: string, fallback: number): number {
  const value = app.node.tryGetContext(key);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`context ${key} must be a number, got ${String(value)}`);
  }
  return parsed;
}

function contextBoolean(app: App, key: string, fallback: boolean): boolean {
  const value = app.node.tryGetContext(key);
  if (value === undefined) {
    return fallback;
  }
  // `-c natGateway=true` arrives as the string "true".
  return value === true || value === 'true' || value === '1';
}
