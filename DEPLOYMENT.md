# Deployment Guide

Comprehensive guide for deploying Multica infrastructure, backend, and frontend to AWS.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [GitHub Secrets Configuration](#github-secrets-configuration)
- [Workflows](#workflows)
- [Deployment Process](#deployment-process)
- [Environment Configuration](#environment-configuration)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)
- [Security Best Practices](#security-best-practices)

## Architecture Overview

The Multica platform consists of three main components:

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub Actions CI/CD                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │Infrastructure│  │   Backend    │  │   Frontend   │      │
│  │  (CDK/IaC)   │  │  (Go API)    │  │  (Next.js)   │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
   ┌──────────────────────────────────────────────┐
   │                    AWS                        │
   ├──────────────────────────────────────────────┤
   │                                               │
   │  ┌──────────────┐  ┌──────────────┐         │
   │  │   EC2/ECS    │  │  PostgreSQL  │         │
   │  │   Instances  │  │     RDS      │         │
   │  └──────────────┘  └──────────────┘         │
   │                                               │
   │  ┌──────────────┐  ┌──────────────┐         │
   │  │     ALB      │  │  CloudFront  │         │
   │  │ Load Balancer│  │     CDN      │         │
   │  └──────────────┘  └──────────────┘         │
   │                                               │
   └───────────────────────────────────────────────┘
```

### Components

| Component | Description | Technology |
|-----------|-------------|------------|
| **Backend** | REST API + WebSocket server | Go (containerized) |
| **Frontend** | Web application | Next.js 16 (containerized) |
| **Database** | Primary data store | PostgreSQL 17 |
| **Infrastructure** | AWS resources (future) | AWS CDK (TypeScript) |

## Prerequisites

### Required Tools

- GitHub account with repository access
- AWS account with appropriate permissions
- AWS CLI v2 configured
- Docker installed locally (for testing)
- Node.js 22+ and pnpm (for local development)
- Go 1.26+ (for backend development)

### AWS Resources

Before deploying, ensure the following AWS resources are provisioned:

1. **EC2 Instances** (or ECS cluster)
   - Instances for dev, staging, and production environments
   - Systems Manager (SSM) agent installed and running
   - Docker installed on each instance

2. **IAM Roles**
   - GitHub Actions OIDC provider configured
   - Deployment roles with appropriate permissions
   - Instance profiles for EC2 instances

3. **Networking**
   - VPC with public/private subnets
   - Security groups configured
   - Application Load Balancer (optional but recommended)

4. **Database**
   - PostgreSQL RDS instance or self-managed PostgreSQL
   - Security groups allowing backend access

## GitHub Secrets Configuration

Configure the following secrets in your GitHub repository settings (`Settings > Secrets and variables > Actions`).

### Global Secrets

These secrets are used across all environments:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `AWS_REGION` | AWS region for deployments | `us-east-1` |
| `GITHUB_TOKEN` | Automatically provided by GitHub Actions | (auto) |

### Environment-Specific Secrets

Configure these secrets for each environment (dev, staging, production):

#### Development Environment

| Secret Name | Description |
|-------------|-------------|
| `AWS_ROLE_ARN_DEV` | IAM role ARN for dev deployments |
| `EC2_INSTANCE_ID_DEV` | EC2 instance ID for dev backend |
| `DEV_API_URL` | Development API URL |
| `DEV_WS_URL` | Development WebSocket URL |

#### Staging Environment

| Secret Name | Description |
|-------------|-------------|
| `AWS_ROLE_ARN_STAGING` | IAM role ARN for staging deployments |
| `EC2_INSTANCE_ID_STAGING` | EC2 instance ID for staging backend |
| `STAGING_API_URL` | Staging API URL |
| `STAGING_WS_URL` | Staging WebSocket URL |

#### Production Environment

| Secret Name | Description |
|-------------|-------------|
| `AWS_ROLE_ARN_PROD` | IAM role ARN for production deployments |
| `EC2_INSTANCE_IDS_PROD` | Comma-separated EC2 instance IDs for production (for rolling deployment) |
| `PROD_API_URL` | Production API URL |
| `PROD_WS_URL` | Production WebSocket URL |

### IAM Role Configuration

Create an IAM role for GitHub Actions with OIDC:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:opex-labs-ai/multica:*"
        }
      }
    }
  ]
}
```

The role should have the following permissions:
- EC2 SSM SendCommand
- ECR pull/push (for GHCR we use GitHub Container Registry)
- CloudWatch Logs (for monitoring)
- S3 (if using S3 for storage)

## Workflows

### 1. Infrastructure Deployment (`deploy-infrastructure.yml`)

**Status:** Template (CDK infrastructure not yet implemented)

Deploys AWS infrastructure using CDK when infrastructure code is added.

**Trigger:**
- Manual workflow dispatch

**Usage:**
```bash
# Via GitHub UI: Actions > Deploy Infrastructure > Run workflow
# Select environment: dev, staging, or production
# Select action: diff, deploy, or destroy
```

**What it does:**
- Sets up Node.js and AWS credentials
- Installs AWS CDK
- Runs CDK synth, diff, or deploy
- Outputs infrastructure endpoints

### 2. Backend Deployment (`deploy-backend.yml`)

Builds, tests, and deploys the Go backend API.

**Triggers:**
- Push to `main` branch (with backend changes) → auto-deploys to dev
- Manual workflow dispatch → deploy to any environment

**Stages:**
1. **Test:** Runs Go tests with race detection and coverage
2. **Security Scan:** 
   - SAST with Gosec
   - Vulnerability scanning with govulncheck
3. **Build:** 
   - Builds Docker image
   - Pushes to GitHub Container Registry
   - Scans image with Trivy
4. **Deploy:** 
   - Deploys to selected environment
   - Runs health checks
   - Executes smoke tests

**Usage:**
```bash
# Automatic: Push to main with backend changes
git push origin main

# Manual: Via GitHub UI
# Actions > Deploy Backend > Run workflow
# Select environment
```

### 3. Frontend Deployment (`deploy-frontend.yml`)

Builds, tests, and deploys the Next.js web application.

**Triggers:**
- Push to `main` branch (with frontend changes) → auto-deploys to dev
- Manual workflow dispatch → deploy to any environment

**Stages:**
1. **Test:** 
   - Type checking
   - Linting
   - Unit tests
2. **Security Scan:** 
   - npm audit
   - Dependency vulnerability scanning
3. **Build:** 
   - Builds Docker image
   - Pushes to GitHub Container Registry
   - Scans image with Trivy
4. **Deploy:** 
   - Deploys to selected environment
   - Runs health checks
   - Executes smoke tests

**Usage:**
```bash
# Automatic: Push to main with frontend changes
git push origin main

# Manual: Via GitHub UI
# Actions > Deploy Frontend > Run workflow
# Select environment
```

### 4. Full Deployment Pipeline (`deploy-full.yml`)

Orchestrates deployment of infrastructure, backend, and frontend together.

**Trigger:**
- Manual workflow dispatch only

**Features:**
- Deploy any combination of components
- Automatic dependency ordering (infrastructure → backend → frontend)
- Post-deployment integration tests
- Comprehensive deployment summary

**Usage:**
```bash
# Via GitHub UI: Actions > Full Deployment Pipeline > Run workflow
# Select:
#   - Environment (dev/staging/production)
#   - Components to deploy (infrastructure/backend/frontend)
```

## Deployment Process

### Development Deployment

Development deployments happen automatically when changes are merged to `main`:

1. Push changes to a feature branch
2. Open a pull request
3. CI runs tests and checks
4. Merge to `main`
5. Deployment workflows automatically trigger for dev environment

### Staging Deployment

Staging deployments are manual and require explicit approval:

1. Navigate to **Actions** tab in GitHub
2. Select the appropriate workflow (Backend, Frontend, or Full)
3. Click **Run workflow**
4. Select `staging` environment
5. Confirm deployment
6. Wait for approval (if configured)
7. Monitor deployment progress

### Production Deployment

Production deployments require careful planning and approval:

1. **Pre-deployment checklist:**
   - ✅ Changes tested in staging
   - ✅ Database migrations reviewed
   - ✅ Rollback plan prepared
   - ✅ Team notified
   - ✅ Monitoring dashboard ready

2. **Deployment:**
   - Navigate to **Actions** tab
   - Select **Full Deployment Pipeline**
   - Click **Run workflow**
   - Select `production` environment
   - Select components to deploy
   - Confirm deployment
   - Wait for manual approval gate
   - Monitor deployment (rolling deployment for zero downtime)

3. **Post-deployment:**
   - Monitor health checks
   - Review application logs
   - Check monitoring dashboards
   - Run smoke tests
   - Notify team of completion

## Environment Configuration

### Environment Variables

Each environment requires specific configuration. Set these on your EC2 instances in `/opt/multica/.env`:

#### Backend Configuration

```env
# Database
DATABASE_URL=postgres://user:password@host:5432/multica?sslmode=require

# Server
PORT=8080
MULTICA_PUBLIC_URL=https://api.example.com

# Authentication
JWT_SECRET=<generated-secret>
MULTICA_VCS_SECRET_KEY=<generated-secret>

# Email (optional)
RESEND_API_KEY=<your-resend-key>

# Storage
LOCAL_UPLOAD_BASE_URL=https://api.example.com

# Telemetry (optional)
DO_NOT_TRACK=false
```

#### Frontend Configuration

```env
# API URLs
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_WS_URL=wss://api.example.com/ws

# App Configuration
NEXT_PUBLIC_APP_URL=https://app.example.com
```

### Environment URLs

| Environment | Frontend URL | API URL |
|-------------|-------------|---------|
| Development | `https://dev.multica.example.com` | `https://dev-api.multica.example.com` |
| Staging | `https://staging.multica.example.com` | `https://staging-api.multica.example.com` |
| Production | `https://multica.example.com` | `https://api.multica.example.com` |

## Rollback Procedures

### Automatic Rollback

The deployment workflows include automatic rollback on failure:
- Failed health checks trigger rollback
- Failed smoke tests trigger rollback
- Infrastructure deployment failures are reported

### Manual Rollback

If you need to manually rollback to a previous version:

#### Using the Rollback Script

```bash
# Rollback backend to previous version
./scripts/deploy/rollback.sh backend v1.2.3 i-1234567890abcdef0

# Rollback frontend to previous version
./scripts/deploy/rollback.sh frontend v1.2.3 i-1234567890abcdef0
```

#### Using GitHub Actions

1. Find the previous successful deployment run
2. Note the Docker image SHA or tag
3. Manually run the deployment workflow
4. Use workflow dispatch with the specific image tag

#### Manual EC2 Rollback

SSH into the instance (or use SSM Session Manager):

```bash
# Connect to instance
aws ssm start-session --target i-1234567890abcdef0

# Rollback backend
cd /opt/multica
docker stop multica-backend
docker rm multica-backend
docker run -d --name multica-backend \
  --restart unless-stopped \
  -p 8080:8080 \
  --env-file /opt/multica/.env \
  ghcr.io/opex-labs-ai/multica/backend:PREVIOUS_TAG

# Verify
docker ps
curl -f http://localhost:8080/health
```

### Database Rollback

For database migrations:

1. **Before deployment:** Take a database snapshot
2. **If rollback needed:**
   - Restore from snapshot, or
   - Run migration rollback scripts (if available)

```bash
# Create snapshot before deployment
aws rds create-db-snapshot \
  --db-instance-identifier multica-prod \
  --db-snapshot-identifier multica-prod-pre-deploy-$(date +%Y%m%d-%H%M%S)

# Restore from snapshot if needed
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier multica-prod \
  --db-snapshot-identifier multica-prod-pre-deploy-TIMESTAMP
```

## Troubleshooting

### Common Issues

#### 1. Health Check Failures

**Symptoms:** Deployment fails at health check stage

**Solutions:**
- Check EC2 instance logs: `docker logs multica-backend`
- Verify environment variables are set correctly
- Check security group allows traffic on the required ports
- Verify database connectivity

```bash
# Check container logs
aws ssm start-session --target INSTANCE_ID
docker logs multica-backend --tail 100

# Test health endpoint locally
curl -v http://localhost:8080/health
```

#### 2. Docker Image Pull Failures

**Symptoms:** Cannot pull Docker image from GHCR

**Solutions:**
- Verify GITHUB_TOKEN has correct permissions
- Check GHCR image exists: `https://github.com/orgs/opex-labs-ai/packages`
- Authenticate Docker on EC2:

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

#### 3. SSM Command Failures

**Symptoms:** AWS SSM send-command fails

**Solutions:**
- Verify SSM agent is running on EC2 instance
- Check IAM role has `AmazonSSMManagedInstanceCore` policy
- Verify instance is in a private subnet with SSM VPC endpoints OR has internet access

```bash
# Check SSM agent status
sudo systemctl status amazon-ssm-agent

# Restart SSM agent
sudo systemctl restart amazon-ssm-agent
```

#### 4. Database Connection Issues

**Symptoms:** Backend cannot connect to PostgreSQL

**Solutions:**
- Verify DATABASE_URL is correct
- Check RDS security group allows traffic from EC2
- Test connection manually:

```bash
psql "$DATABASE_URL"
```

### Viewing Logs

#### GitHub Actions Logs

1. Go to repository **Actions** tab
2. Select the workflow run
3. Click on the job to see detailed logs

#### EC2 Container Logs

```bash
# Via SSM Session Manager
aws ssm start-session --target INSTANCE_ID

# View backend logs
docker logs multica-backend --tail 100 --follow

# View frontend logs
docker logs multica-web --tail 100 --follow
```

#### CloudWatch Logs

If CloudWatch logging is configured:

```bash
# View recent logs
aws logs tail /aws/ec2/multica-backend --follow

# Filter logs
aws logs filter-log-events \
  --log-group-name /aws/ec2/multica-backend \
  --filter-pattern "ERROR"
```

## Security Best Practices

### 1. Secrets Management

- ✅ Store all secrets in GitHub Secrets or AWS Secrets Manager
- ✅ Never commit secrets to git repository
- ✅ Rotate secrets regularly
- ✅ Use different secrets for each environment

### 2. IAM Permissions

- ✅ Use least-privilege IAM policies
- ✅ Use IAM roles instead of access keys
- ✅ Enable AWS CloudTrail for audit logging
- ✅ Use separate roles for each environment

### 3. Network Security

- ✅ Place backend in private subnets
- ✅ Use security groups to restrict access
- ✅ Enable VPC flow logs
- ✅ Use ALB/NLB for load balancing
- ✅ Enable DDoS protection with AWS Shield

### 4. Application Security

- ✅ Keep dependencies up to date
- ✅ Run security scanning in CI/CD
- ✅ Enable HTTPS/TLS everywhere
- ✅ Implement rate limiting
- ✅ Use CSP headers and security headers

### 5. Monitoring and Alerting

- ✅ Set up CloudWatch alarms for critical metrics
- ✅ Monitor application logs
- ✅ Enable AWS GuardDuty
- ✅ Set up PagerDuty/Opsgenie for on-call
- ✅ Create runbooks for common incidents

### 6. Deployment Safety

- ✅ Always test in staging before production
- ✅ Use blue-green or rolling deployments
- ✅ Take database backups before migrations
- ✅ Have a rollback plan ready
- ✅ Monitor deployments actively

## Additional Resources

- [Self-Hosting Guide](./SELF_HOSTING.md) - Running Multica locally
- [Contributing Guide](./CONTRIBUTING.md) - Development setup
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/) - Infrastructure as Code
- [GitHub Actions Documentation](https://docs.github.com/en/actions) - CI/CD
- [Docker Documentation](https://docs.docker.com/) - Containerization

## Support

For deployment issues or questions:

1. Check this documentation first
2. Review [GitHub Issues](https://github.com/opex-labs-ai/multica/issues)
3. Contact the DevOps team
4. Create a new issue with the `deployment` label

---

**Last Updated:** 2026-10-04
**Version:** 1.0.0
