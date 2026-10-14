# Agent runtime infrastructure

One EC2 machine that runs the Multica daemon and the Claude Code runtimes our
agents execute on. That is the whole stack.

Multica itself is used as a hosted service, so nothing here deploys the web
app, the Go server, Postgres, Redis or a CDN. What the team needs from AWS is
somewhere for agents to run, and that is what this provisions.

## What gets created

| Resource | Why |
| --- | --- |
| VPC, one AZ, `10.20.0.0/24` | Somewhere to put the instance. One AZ: the box holds no state a replacement would not re-create. |
| Security group, no ingress rules | The machine listens on nothing. The daemon dials out to Multica; Session Manager dials out to SSM. |
| EC2 instance, `t4g.medium` (Graviton, arm64) | Runs the daemon as the non-root `multica` user. |
| IAM role | Session Manager, Bedrock inference on Anthropic models, read on this machine's own SSM parameters, write to its own log group. Nothing else. |
| CloudWatch log group, 14-day retention | Daemon log and cloud-init output, shipped by the CloudWatch agent. |

There is no key pair and no SSH. Operators connect with Session Manager, which
also gives a single place to audit who went in.

Roughly **$30/month** in `ap-south-1`: `t4g.medium` ~$24, 40 GiB gp3 ~$3,
public IPv4 ~$4, logs under $1. Bedrock usage is billed per token on top, and
only when an agent falls back to the `claude-bedrock` runtime.

## The two runtimes

The machine installs Claude Code once and exposes it through two wrappers on
`PATH`. Each is the `command` of a [custom runtime
profile](https://multica.ai/docs/daemon-runtimes#custom-runtime-profiles) in
the workspace, so agents pick between them the same way they pick any runtime.

| Wrapper | Authentication | Role |
| --- | --- | --- |
| `claude-max` | `CLAUDE_CODE_OAUTH_TOKEN` from the team's Claude subscription | primary |
| `claude-bedrock` | `CLAUDE_CODE_USE_BEDROCK=1` plus the instance role | fallback |

Each wrapper unsets the other's credentials, so which one a run used is never
ambiguous. Adding a third provider, model or region later is one more wrapper
and one more profile — no change to this stack.

Multica has no automatic fallback between runtimes today: when the subscription
hits its limit the run fails with `provider_quota_limit` and someone switches
the agent to `claude-bedrock` and retries. The runtime fallback chain that
would automate this is application work, tracked separately.

## Credentials

Three values live in SSM Parameter Store as `SecureString` parameters under
`/multica/agent-runtime`, created by `scripts/bootstrap.sh` and never by
CloudFormation — no secret enters a template, a change set or the CDK context.

| Parameter | What it is |
| --- | --- |
| `multica-token` | Multica personal access token (`mul_…`). The daemon logs in with it, so its owner owns the registered runtimes and is the one who can make them public. |
| `claude-oauth-token` | Output of `claude setup-token` on a machine signed in to the subscription. |
| `github-token` | Fine-grained PAT or GitHub App installation token, limited to the agents' repositories. |

On the instance nothing is written to the root volume:

- `multica-fetch-secrets` pulls all three into `/run/multica` (tmpfs) on every
  service start, mode `0400`, owned by the `multica` user.
- The Multica PAT reaches `multica login` on stdin, not as an argument, so it
  stays out of `/proc/*/cmdline`.
- Git reads the GitHub token through a credential helper that reads tmpfs, so
  there is no `~/.git-credentials`.

Rotating a credential is `aws ssm put-parameter --overwrite` followed by
`sudo systemctl restart multica-daemon`.

## Deploying

Requirements: Node.js 22+, the AWS CLI, credentials for the target account, and
the [Session Manager
plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
for connecting afterwards.

```bash
pnpm install                      # from the repository root
cd infrastructure
./scripts/bootstrap.sh            # CDK bootstrap + the three SSM parameters
./scripts/deploy.sh               # shows a diff, asks, then deploys
./scripts/connect.sh              # Session Manager shell on the machine
```

`deploy.sh` leaves `--require-approval` at CDK's default, so a change that
widens a security group or an IAM policy stops and asks before it is applied.

First boot takes a few minutes. Watch it with `sudo cloud-init status --long`
on the machine, or read the `bootstrap` log stream in CloudWatch.

### Context overrides

```bash
./scripts/deploy.sh -c instanceType=t4g.large -c natGateway=true
```

| Context key | Default | Notes |
| --- | --- | --- |
| `instanceType` | `t4g.medium` | Graviton families only; the AMI is arm64 and synth rejects an x86 type. |
| `volumeSizeGb` | `40` | Checkouts plus `node_modules` for every concurrent run. |
| `natGateway` | `false` | See below. |
| `serverUrl` | `https://api.multica.ai` | Point at a self-hosted server instead. |
| `parameterPrefix` | `/multica/agent-runtime` | Must match what `bootstrap.sh` wrote. |
| `cliVersion` | `latest` | Pin a release tag (`v0.6.1`) for a reproducible build. |
| `nodeMajorVersion` | `22` | Node.js major Claude Code runs on. |
| `logRetentionDays` | `14` | Must be a CloudWatch retention period. |
| `maxConcurrentTasks` | `4` | `MULTICA_DAEMON_MAX_CONCURRENT_TASKS`. Parallel runs share this machine's CPU, disk and the same subscription quota. |

### Public subnet or NAT gateway

By default the instance sits in a public subnet with a public IP, no inbound
rules, and no key pair. It reaches npm, GitHub, the Anthropic API and Multica
directly. A NAT gateway would add about $33/month plus data processing for a
box that already accepts no inbound traffic.

`-c natGateway=true` moves it to a private subnet behind a NAT gateway if a
policy requires no instance to carry a public IP. Session Manager keeps working
either way, since the agent dials out.

## Workspace setup after the first deploy

The stack provisions the machine; the runtimes, agents and skills are workspace
configuration. Once the daemon is online (Multica → **Runtimes** shows
`multica-agent-runtime`):

1. Create the two custom runtime profiles, from any machine signed in to the
   workspace:

   ```bash
   multica runtime profile create --runtime-type claude \
     --command-name claude-max --display-name "Claude (subscription)"
   multica runtime profile create --runtime-type claude \
     --command-name claude-bedrock --display-name "Claude (Bedrock)"
   ```

   Only the machines that resolve the command on `PATH` register the runtime,
   so these appear on this box and nowhere else.

2. Mark both runtimes public, so every member's agents can use them. Only the
   runtime's owner — the identity behind `multica-token` — can do that.

3. Create the shared agents, bind the repositories to projects, and attach the
   team's conventions as skills.

## Operating it

```bash
./scripts/connect.sh                            # Session Manager shell
sudo systemctl status multica-daemon
sudo tail -f /var/log/multica/daemon.log        # also in CloudWatch
sudo systemctl restart multica-daemon           # re-reads every credential
```

Changing `assets/bootstrap.sh` replaces the instance on the next deploy
(`userDataCausesReplacement`), which is the point: that script is the machine's
entire configuration, and an edit that only updated the launch template would
leave the running box behind.

## Accepted risks

- Agent runs skip approval prompts, so anyone who can assign an issue to a
  shared agent can run commands on this machine. That is acceptable for a
  trusted team on a box that holds no production credentials — the instance
  role reaches Bedrock and its own parameters, nothing else.
- All shared agents draw on one Claude subscription, so expect to fall back to
  Bedrock regularly.
- One instance, one AZ. If it is replaced, in-flight runs are lost; the issues
  stay in Multica and can be reassigned.

## Layout

```
infrastructure/
├── bin/app.ts                        CDK app: one stack
├── lib/config.ts                     Context parsing and validation
├── lib/agent-runtime-stack.ts        VPC, security group, role, instance, logs
├── lib/bootstrap.ts                  Renders the bootstrap script
├── assets/bootstrap.sh               What the machine does on first boot
├── test/agent-runtime-stack.test.ts  Assertions on the synthesized template
└── scripts/                          bootstrap, deploy, connect, destroy
```

`pnpm --filter @multica/infrastructure test` runs the template assertions —
no AWS credentials, no deploy. They cover the claims that are easy to get wrong
by hand: no inbound rules, no key pair, one security group, an instance role
that reaches only Bedrock, Parameter Store and its own log group, an encrypted
root volume, IMDSv2, and a bootstrap script that starts the daemon as a
non-root user without writing a credential to disk.
