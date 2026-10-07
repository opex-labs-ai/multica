import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentRuntimeConfig } from './config';

export interface BootstrapValues {
  config: AgentRuntimeConfig;
  /** Region the instance runs in. May be a CDK token. */
  region: string;
  /** CloudWatch log group the CloudWatch agent writes to. */
  logGroupName: string;
}

/**
 * Reads assets/bootstrap.sh and substitutes its @@PLACEHOLDER@@ markers.
 *
 * The script lives in its own file rather than in a template literal so it can
 * be read, reviewed and syntax-checked as a shell script (see the workflow's
 * `bash -n` step). Values may be CDK tokens: the rendered string goes through
 * Fn::Base64, so a token resolves to a CloudFormation intrinsic and the
 * instance receives the real value.
 */
export function renderBootstrap(values: BootstrapValues): string {
  const { config } = values;
  const substitutions: Record<string, string> = {
    REGION: values.region,
    PARAM_PREFIX: config.parameterPrefix,
    SERVER_URL: config.serverUrl,
    CLI_VERSION: config.cliVersion,
    NODE_MAJOR: config.nodeMajorVersion,
    LOG_GROUP: values.logGroupName,
    MAX_CONCURRENT_TASKS: String(config.maxConcurrentTasks),
  };

  const source = readFileSync(join(__dirname, '..', 'assets', 'bootstrap.sh'), 'utf8');
  const rendered = source.replace(/@@([A-Z_]+)@@/g, (_match, name: string) => {
    const value = substitutions[name];
    if (value === undefined) {
      throw new Error(`assets/bootstrap.sh references unknown placeholder @@${name}@@`);
    }
    return value;
  });

  // A leftover marker means the asset and this map have drifted apart, which
  // would ship a machine that configures itself with the literal text.
  const leftover = rendered.match(/@@\w+@@/);
  if (leftover) {
    throw new Error(`assets/bootstrap.sh still contains ${leftover[0]} after rendering`);
  }
  return rendered;
}
