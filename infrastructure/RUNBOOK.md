# Agent runtime runbook

How the shared agent runtime is set up for the OpexLabs workspace and how to
run it. [README.md](README.md) covers what the stack creates and why; this file
covers the deployed state and day-to-day operations.

## Current setup

One EC2 machine in `ap-south-1` (stack `Multica-AgentRuntime`) runs the Multica
daemon for the workspace. Multica itself is the hosted service at multica.ai,
so there is no domain, load balancer or open port. The machine connects out to
Multica, Anthropic, Bedrock, GitHub, Parameter Store and CloudWatch, and
nothing connects in.

The daemon registers these runtimes in the workspace:

| Runtime | Command on the machine | Auth | Visibility |
| --- | --- | --- | --- |
| Claude (subscription) | `claude-max` | Team Claude subscription (OAuth token) | public |
| Claude (Bedrock) | `claude-bedrock` | Amazon Bedrock through the instance role | public |
| Claude | `claude` | none | private; to be deleted |

Subscription is the primary runtime. Multica has no automatic fallback: when a
run fails with `provider_quota_limit`, switch the agent to Bedrock and retry.

The runtimes belong to the owner of the Multica token in Parameter Store, and
only that person can change their visibility. The daemon ID is pinned in
[cdk.json](cdk.json) (`daemonId`), so replacing the instance keeps the same
runtimes, their visibility and their agent bindings.

## Access

Day to day, nobody touches the machine: create an agent in Multica, pick one of
the two public runtimes, and assign it issues.

To operate the machine you need AWS credentials for the account with
Session Manager access, and the [Session Manager
plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
(`brew install --cask session-manager-plugin`).

```bash
export AWS_REGION=ap-south-1
./scripts/connect.sh                              # shell on the machine
sudo systemctl status multica-daemon
sudo tail -f /opt/multica/.multica/daemon.log     # daemon log
sudo -iu multica                                  # act as the agent user

aws logs tail /multica/Multica-AgentRuntime --follow   # logs without a shell
```

## Operations

**Rotate a credential.** Write the new value, then restart the daemon on the
machine:

```bash
aws ssm put-parameter --overwrite --type SecureString \
  --name /multica/agent-runtime/<multica-token|claude-oauth-token|github-token> \
  --value '<new value>'
sudo systemctl restart multica-daemon
```

- `multica-token`: a Multica personal access token. Its owner owns the runtimes.
- `claude-oauth-token`: run `claude setup-token` on an account signed in to the team subscription.
- `github-token`: a fine-grained token limited to the agents' repositories.

**Deploy a change.** Merge to `main`, then run `./scripts/deploy.sh`, or run
the Infrastructure workflow in GitHub Actions (the `aws-agent-runtime`
environment needs a reviewer's approval). Any change to `assets/bootstrap.sh`
replaces the instance. If `ap-south-1a` is out of `t4g.medium` capacity, the
deploy rolls back and the old machine keeps running; retry later.

**Bedrock access.** If a Bedrock run fails with an access error, enable
Anthropic model access in the Bedrock console for `ap-south-1`.

## Next steps

- [ ] Delete the plain `Claude` runtime (`multica runtime list`, then `multica runtime delete <id>`).
- [ ] Create the shared agents on `Claude (subscription)`, bind repositories to projects, and add team conventions as skills.
- [ ] Run one test issue on each runtime. This confirms the Claude token works and Bedrock is open to Anthropic models.
- [ ] Run the Infrastructure workflow once with `diff` to confirm the GitHub Actions deploy role works.
- [ ] If `ap-south-1a` keeps running out of capacity, let the stack choose another AZ. That replaces the subnet.
