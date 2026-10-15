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

### State as of 2026-10-15

- The machine is built from `main`, with no manual changes.
- All three credentials were rotated on 2026-10-15.
- The workspace has no projects, agents, repositories, squads or autopilots yet; setting those up is the next step below.
- No agent has run on either runtime yet.

## Access

Day to day, nobody touches the machine: create an agent in Multica, pick one of
the two public runtimes, and assign it issues.

To operate the machine you need AWS credentials for the account, and the
`MulticaAgentRuntimeOperator` IAM policy attached to your user. The policy grants
a shell on this instance and lets you write (not read) the runtime's parameters.
You also need the [Session Manager
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
the Infrastructure workflow in GitHub Actions. The `aws-agent-runtime`
environment needs a reviewer's approval, and its deploy role is separate from
your own AWS permissions. Any change to `assets/bootstrap.sh`
replaces the instance. If `ap-south-1a` is out of `t4g.medium` capacity, the
deploy rolls back and the old machine keeps running; retry later.

**Bedrock access.** If a Bedrock run fails with an access error, enable
Anthropic model access in the Bedrock console for `ap-south-1`.

## Next steps: workspace setup

The machine is ready. What's left is workspace configuration in Multica, and a
workspace admin can do it from the web app or the `multica` CLI
(`brew install multica-ai/tap/multica`, then `multica login`). Don't run
`multica setup` or `multica daemon start` on a laptop unless you want it
registered as another runtime.

### 1. Check the runtimes

- [ ] Delete the plain `Claude` runtime, which has no credentials: run `multica runtime list`, then `multica runtime delete <id>`.

### 2. Repositories and projects

A project groups related issues and carries their working context. A GitHub
repository attached to a project is checked out for every run on that
project's issues ([docs](../apps/docs/content/docs/project-resources.mdx)).

- [ ] Connect GitHub under **Settings → Code**, so PRs link to issues and a merged PR moves its issue ([docs](../apps/docs/content/docs/github-integration.mdx)).
- [ ] Register the repositories agents may work on: `multica repo add https://github.com/<org>/<repo>`.
- [ ] Create one project per product or workstream, with its repository attached:

  ```bash
  multica project create --title "<name>" --repo https://github.com/<org>/<repo> --description "<brief>"
  ```

- [ ] Write each project's description as the brief agents read: goal, constraints, where things live, how to run tests.

### 3. Planning: statuses, labels and sprints

Multica has no built-in sprint or cycle object. Use a custom property for the
sprint, and statuses and labels for the rest
([issues docs](../apps/docs/content/docs/issues.mdx)).

- [ ] Add any statuses the team's flow needs beyond the seven built-in ones, for example `QA`, under **Settings → Issue Statuses**. A status's category can't be changed later, so choose it first.
- [ ] Create the labels the team filters by (area, type): `multica label create --name <name> --color '#3b82f6'`.
- [ ] Create the sprint property, and add an option for each new sprint as it starts:

  ```bash
  multica property create --name Sprint --type select --option "Sprint 1" --option "Sprint 2"
  multica property create --name Estimate --type number
  ```

- [ ] Agree on a planning routine: the backlog lives in **Backlog**, planning sets `Sprint` and moves issues to **Todo**, and agents pick up what is assigned to them.

### 4. Agents

Create agents on `Claude (subscription)` with the permission mode set to public to the workspace, so every member can assign them work. When the subscription hits its limit, copy or move an agent to `Claude (Bedrock)`
([docs](../apps/docs/content/docs/agents-create.mdx)).

```bash
multica agent create --name "<name>" --runtime-id <Claude (subscription) id> \
  --permission-mode public_to --public-to-workspace \
  --description "<one line>" --instructions "<role, scope, definition of done>"
```

A starting set to adapt:

| Agent | Does |
| --- | --- |
| Planner | Breaks requirements into issues with acceptance criteria, estimates them and proposes the sprint |
| Developer | Implements an issue in the project's repository and opens a PR |
| Reviewer | Reviews PRs against the repository's conventions and the issue's acceptance criteria |

- [ ] Create the agents and run one small test issue on each runtime. This confirms the Claude token works, the GitHub token can clone the private repositories, and Bedrock is open to Anthropic models (if not, enable model access in the Bedrock console for `ap-south-1`).
- [ ] Put shared conventions in skills (`multica skill create` or `multica skill import`) and attach them to the agents (`multica agent skills`), instead of repeating them in each agent's instructions ([docs](../apps/docs/content/docs/skills.mdx)).
- [ ] Optionally, create a squad with the Planner as leader, so an issue assigned to the squad is routed to the right agent: `multica squad create --name "<name>" --leader Planner` ([docs](../apps/docs/content/docs/squads.mdx)).

### 5. Recurring work

Autopilots run an agent on a schedule ([docs](../apps/docs/content/docs/autopilots.mdx)).
For example, a weekly sprint-planning issue for the Planner every Monday at
09:00 IST:

```bash
multica autopilot create --title "Sprint planning" --agent Planner --mode create_issue \
  --issue-title-template "Sprint planning {{date}}" \
  --description "Review the backlog, propose the next sprint and set the Sprint property on the chosen issues."
multica autopilot trigger-add <autopilot-id> --kind schedule --cron "0 9 * * 1" --timezone Asia/Kolkata
```

### 6. Infrastructure follow-ups

- [ ] Run the Infrastructure workflow once with `diff` to confirm the GitHub Actions deploy role works.
- [ ] If `ap-south-1a` keeps running out of `t4g.medium` capacity, let the stack choose another AZ. That replaces the subnet.
