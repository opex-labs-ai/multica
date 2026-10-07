#!/bin/bash
# Bootstrap for the Multica agent runtime machine (Amazon Linux 2023, arm64).
#
# Rendered by lib/bootstrap.ts, which substitutes the marked placeholders
# below at synth time. Keeping the script in its own file lets it stay readable
# and syntax-checkable (the workflow runs `bash -n` over it). cloud-init
# runs it once, as root, on first boot; output lands in
# /var/log/cloud-init-output.log and is shipped to CloudWatch Logs.
#
# What it installs:
#   - Node.js and Claude Code, the only agent CLI this machine runs
#   - the Multica CLI, logged in from an SSM parameter and run as a systemd
#     service under a non-root user
#   - two wrapper commands, claude-max and claude-bedrock, that the workspace's
#     custom runtime profiles resolve on PATH
#
# No credential is written to the root volume. Tokens are pulled from SSM
# Parameter Store into tmpfs (/run/multica) on every service start, owned by the
# runtime user and mode 0400, and git reads its token through a credential
# helper rather than from ~/.git-credentials.
set -euo pipefail

REGION="@@REGION@@"
PARAM_PREFIX="@@PARAM_PREFIX@@"
SERVER_URL="@@SERVER_URL@@"
CLI_VERSION="@@CLI_VERSION@@"
NODE_MAJOR="@@NODE_MAJOR@@"
LOG_GROUP="@@LOG_GROUP@@"
MAX_CONCURRENT_TASKS="@@MAX_CONCURRENT_TASKS@@"

RUNTIME_USER="multica"
RUNTIME_HOME="/opt/multica"

log() { echo "[multica-bootstrap] $*"; }
trap 'log "FAILED on line ${LINENO}"' ERR

log "Installing base packages"
dnf -y install git tar gzip jq amazon-cloudwatch-agent

log "Installing Node.js ${NODE_MAJOR}"
curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource-setup.sh
bash /tmp/nodesource-setup.sh
rm -f /tmp/nodesource-setup.sh
dnf -y install nodejs

log "Installing Claude Code"
npm install -g @anthropic-ai/claude-code

log "Installing the Multica CLI"
if [ "${CLI_VERSION}" = "latest" ]; then
  cli_tag="$(curl -fsSI https://github.com/multica-ai/multica/releases/latest |
    grep -i '^location:' | sed 's|.*/tag/||' | tr -d '\r\n')"
else
  cli_tag="${CLI_VERSION}"
fi
if [ -z "${cli_tag}" ]; then
  log "could not resolve a Multica CLI release tag"
  exit 1
fi
cli_semver="${cli_tag#v}"
curl -fsSL \
  "https://github.com/multica-ai/multica/releases/download/${cli_tag}/multica-cli-${cli_semver}-linux-arm64.tar.gz" \
  -o /tmp/multica.tar.gz
tar -xzf /tmp/multica.tar.gz -C /tmp multica
install -m 0755 /tmp/multica /usr/local/bin/multica
rm -f /tmp/multica /tmp/multica.tar.gz
log "Installed Multica CLI ${cli_tag}"

log "Creating the ${RUNTIME_USER} service account"
id -u "${RUNTIME_USER}" >/dev/null 2>&1 ||
  useradd --system --create-home --home-dir "${RUNTIME_HOME}" --shell /bin/bash "${RUNTIME_USER}"
install -d -m 0755 -o "${RUNTIME_USER}" -g "${RUNTIME_USER}" "${RUNTIME_HOME}/workspaces"

# ---------------------------------------------------------------------------
# Runtime wrappers
#
# Each one is the `command` of a custom runtime profile in the Multica
# workspace. The daemon resolves it on PATH and appends its own protocol
# arguments after it. The heredocs are quoted, so nothing in a wrapper body is
# expanded while it is written; the only values baked in are the synth
# placeholders, which are already substituted by the time this runs.
# ---------------------------------------------------------------------------
log "Writing the runtime wrappers"
cat >/usr/local/bin/claude-max <<'WRAPPER'
#!/bin/bash
# Claude Code on the team's Claude subscription. Primary runtime.
set -euo pipefail
CLAUDE_CODE_OAUTH_TOKEN="$(cat /run/multica/claude-oauth-token)"
export CLAUDE_CODE_OAUTH_TOKEN
# Leave no ambiguity about which credential wins: no Bedrock, no Vertex, no key.
unset CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX ANTHROPIC_API_KEY
exec claude "$@"
WRAPPER
chmod 0755 /usr/local/bin/claude-max

cat >/usr/local/bin/claude-bedrock <<'WRAPPER'
#!/bin/bash
# Claude Code on Amazon Bedrock through the instance role. Fallback runtime for
# when the subscription has hit its limit.
set -euo pipefail
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_REGION="@@REGION@@"
unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY
exec claude "$@"
WRAPPER
chmod 0755 /usr/local/bin/claude-bedrock

# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------
log "Writing the credential helpers"
install -d -m 0755 /usr/local/libexec

cat >/usr/local/libexec/multica-fetch-secrets <<'FETCH'
#!/bin/bash
# Pulls the runtime's credentials from SSM Parameter Store into tmpfs. Runs as
# root from systemd ExecStartPre, before the daemon starts, on every start.
set -euo pipefail
REGION="@@REGION@@"
PARAM_PREFIX="@@PARAM_PREFIX@@"
RUNTIME_USER="multica"

install -d -m 0750 -o "${RUNTIME_USER}" -g "${RUNTIME_USER}" /run/multica

fetch() {
  local name="$1" dest="$2" value
  value="$(aws ssm get-parameter --region "${REGION}" --name "${PARAM_PREFIX}/${name}" \
    --with-decryption --query Parameter.Value --output text)"
  if [ -z "${value}" ] || [ "${value}" = "None" ]; then
    echo "SSM parameter ${PARAM_PREFIX}/${name} is empty" >&2
    exit 1
  fi
  # printf rather than redirecting the command output: --output text appends a
  # newline that would otherwise travel into the token.
  printf '%s' "${value}" >"${dest}.tmp"
  chown "${RUNTIME_USER}:${RUNTIME_USER}" "${dest}.tmp"
  chmod 0400 "${dest}.tmp"
  mv "${dest}.tmp" "${dest}"
}

fetch multica-token /run/multica/multica-token
fetch claude-oauth-token /run/multica/claude-oauth-token
fetch github-token /run/multica/github-token
FETCH
chmod 0750 /usr/local/libexec/multica-fetch-secrets

cat >/usr/local/libexec/multica-git-credential <<'GITCRED'
#!/bin/bash
# git credential helper. Serves the GitHub token from tmpfs so it never lands
# in ~/.git-credentials on the root volume.
set -euo pipefail
[ "${1:-}" = "get" ] || exit 0
printf 'username=x-access-token\npassword=%s\n' "$(cat /run/multica/github-token)"
GITCRED
chmod 0755 /usr/local/libexec/multica-git-credential

git config --system credential.https://github.com.helper /usr/local/libexec/multica-git-credential
git config --system user.name "Multica Agent"
git config --system user.email "multica-agent@users.noreply.github.com"

cat >/usr/local/libexec/multica-login <<'LOGIN'
#!/bin/bash
# Points the CLI at the server and signs in with the PAT from tmpfs. Runs as the
# runtime user from systemd ExecStartPre; re-running it is an idempotent
# refresh. The token arrives on stdin, not argv, so it stays out of
# /proc/*/cmdline.
set -euo pipefail
SERVER_URL="@@SERVER_URL@@"
multica config set server_url "${SERVER_URL}"
multica login --token </run/multica/multica-token
LOGIN
chmod 0755 /usr/local/libexec/multica-login

# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------
log "Installing the multica-daemon service"
cat >/etc/systemd/system/multica-daemon.service <<'UNIT'
[Unit]
Description=Multica agent daemon
Documentation=https://github.com/multica-ai/multica/blob/main/CLI_AND_DAEMON.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=multica
Group=multica
WorkingDirectory=/opt/multica
Environment=HOME=/opt/multica
Environment=PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin
Environment=MULTICA_WORKSPACES_ROOT=/opt/multica/workspaces
Environment=MULTICA_DAEMON_MAX_CONCURRENT_TASKS=@@MAX_CONCURRENT_TASKS@@
Environment=MULTICA_DAEMON_DEVICE_NAME=multica-agent-runtime
# "+" runs this one as root: it writes the tmpfs credentials that the service
# user then reads.
ExecStartPre=+/usr/local/libexec/multica-fetch-secrets
ExecStartPre=/usr/local/libexec/multica-login
ExecStart=/usr/local/bin/multica daemon start --foreground
Restart=always
RestartSec=10
NoNewPrivileges=true
LogsDirectory=multica
StandardOutput=append:/var/log/multica/daemon.log
StandardError=append:/var/log/multica/daemon.log

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/logrotate.d/multica-daemon <<'ROTATE'
/var/log/multica/daemon.log {
    daily
    rotate 7
    missingok
    notifempty
    compress
    copytruncate
}
ROTATE

log "Configuring the CloudWatch agent"
install -d -m 0755 /opt/aws/amazon-cloudwatch-agent/etc
cat >/opt/aws/amazon-cloudwatch-agent/etc/multica.json <<CWAGENT
{
  "agent": { "run_as_user": "root" },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/multica/daemon.log",
            "log_group_name": "${LOG_GROUP}",
            "log_stream_name": "{instance_id}/daemon",
            "timezone": "UTC"
          },
          {
            "file_path": "/var/log/cloud-init-output.log",
            "log_group_name": "${LOG_GROUP}",
            "log_stream_name": "{instance_id}/bootstrap",
            "timezone": "UTC"
          }
        ]
      }
    }
  }
}
CWAGENT
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/multica.json

log "Starting the daemon"
systemctl daemon-reload
systemctl enable --now multica-daemon.service

log "Bootstrap complete"
