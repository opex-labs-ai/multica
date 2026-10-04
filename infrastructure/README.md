# Multica AWS CDK Infrastructure

This directory contains AWS CDK infrastructure code for deploying the Multica platform to AWS. The infrastructure is designed to be production-ready, secure, and scalable.

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Infrastructure Components](#infrastructure-components)
- [Cost Estimation](#cost-estimation)
- [Monitoring and Logging](#monitoring-and-logging)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Rollback Procedures](#rollback-procedures)

## Architecture

```mermaid
graph TB
    subgraph "AWS Cloud"
        subgraph "Public Subnets"
            ALB[Application Load Balancer]
            NAT[NAT Gateway]
        end
        
        subgraph "Private Subnets"
            ASG[Auto Scaling Group<br/>Backend EC2 Instances]
        end
        
        subgraph "Isolated Subnets"
            RDS[(RDS PostgreSQL<br/>Multi-AZ)]
        end
        
        CF[CloudFront CDN] --> S3[S3 Bucket<br/>Frontend Static Files]
        
        Internet((Internet)) --> CF
        Internet --> ALB
        
        ALB --> ASG
        ASG --> RDS
        ASG --> S3Assets[S3 Assets Bucket]
        
        ASG --> Secrets[AWS Secrets Manager<br/>DB & JWT Secrets]
        
        CloudWatch[CloudWatch Logs<br/>& Metrics]
        ASG --> CloudWatch
        RDS --> CloudWatch
        ALB --> CloudWatch
    end
    
    Users[Users] --> Internet
    
    style Users fill:#e1f5ff
    style CF fill:#ff9900
    style ALB fill:#ff9900
    style ASG fill:#ff9900
    style RDS fill:#3b48cc
    style S3 fill:#3b48cc
    style S3Assets fill:#3b48cc
    style CloudWatch fill:#ff9900
```

### Architecture Overview

The infrastructure consists of four main stacks:

1. **Network Stack**: VPC, subnets, NAT gateways, security groups
2. **Database Stack**: RDS PostgreSQL with automated backups and encryption
3. **Backend Stack**: EC2 Auto Scaling Group behind Application Load Balancer
4. **Frontend Stack**: S3 + CloudFront for static website hosting

## Prerequisites

### Required Software

- **Node.js**: Version 22 or higher
  - Check: `node --version`
  - Install: https://nodejs.org/

- **AWS CLI**: Version 2.x
  - Check: `aws --version`
  - Install: https://aws.amazon.com/cli/

- **AWS CDK CLI**: Version 2.x
  - Install: `npm install -g aws-cdk`
  - Check: `cdk --version`

- **Git**: For version control
  - Check: `git --version`

### AWS Account Requirements

- An AWS account with appropriate permissions
- AWS credentials configured (via `aws configure` or environment variables)
- Sufficient service quotas for:
  - VPCs
  - EC2 instances
  - RDS instances
  - Elastic IPs
  - CloudFront distributions

### Required AWS Permissions

Your AWS user/role needs permissions for:
- CloudFormation (full access)
- EC2 (VPC, Security Groups, Instances)
- RDS (Instance creation and management)
- S3 (Bucket creation and management)
- CloudFront (Distribution management)
- IAM (Role and policy creation)
- Secrets Manager (Secret management)
- CloudWatch (Logs and metrics)

## Project Structure

```
infrastructure/
├── bin/
│   └── app.ts                 # CDK application entry point
├── lib/
│   ├── config.ts             # Environment-specific configurations
│   ├── network-stack.ts      # VPC and networking resources
│   ├── database-stack.ts     # RDS PostgreSQL database
│   ├── backend-stack.ts      # Backend EC2 and ALB
│   └── frontend-stack.ts     # S3 and CloudFront for frontend
├── scripts/
│   ├── bootstrap.sh          # Initial AWS CDK setup
│   ├── deploy.sh            # Deployment script
│   └── destroy.sh           # Infrastructure teardown
├── cdk.json                 # CDK configuration
├── package.json             # Node.js dependencies
├── tsconfig.json            # TypeScript configuration
└── README.md               # This file
```

## Configuration

### Environment-Specific Settings

The infrastructure supports three environments: `dev`, `staging`, and `prod`. Configuration is managed in `lib/config.ts`.

Key configuration parameters:

- **VPC CIDR blocks**: Separate IP ranges per environment
- **Instance types**: Smaller for dev, larger for production
- **Database settings**: Storage, backup retention, Multi-AZ
- **Auto Scaling**: Min/max/desired capacity
- **Monitoring**: Detailed monitoring enabled for staging/prod

### Customizing Configuration

Edit `lib/config.ts` to adjust:

```typescript
const configurations: Record<string, EnvironmentConfig> = {
  prod: {
    // Database
    databaseInstanceType: 'db.r6g.large',
    databaseAllocatedStorage: 100,
    
    // Backend
    backendInstanceType: 't3.large',
    backendMinCapacity: 3,
    backendMaxCapacity: 10,
    
    // Custom domain (optional)
    frontendDomainName: 'app.yourdomain.com',
    frontendCertificateArn: 'arn:aws:acm:...',
  },
};
```

## Deployment

### Step 1: AWS Credentials Setup

Configure your AWS credentials:

```bash
# Option 1: Using AWS CLI
aws configure

# Option 2: Using environment variables
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-east-1
```

Verify credentials:
```bash
aws sts get-caller-identity
```

### Step 2: Bootstrap CDK

Run this once per AWS account/region:

```bash
cd infrastructure
./scripts/bootstrap.sh
```

Or manually:

```bash
cd infrastructure
npm install
cdk bootstrap
```

### Step 3: Review Infrastructure

Synthesize CloudFormation templates (dry run):

```bash
# Development environment
npm run cdk:synth -- --context environment=dev

# Staging environment
npm run cdk:synth -- --context environment=staging

# Production environment
npm run cdk:synth -- --context environment=prod
```

View the changes that will be made:

```bash
npm run cdk:diff -- --context environment=dev
```

### Step 4: Deploy Infrastructure

#### Deploy to Development

```bash
./scripts/deploy.sh dev
```

Or using npm scripts:

```bash
npm run deploy:dev
```

#### Deploy to Staging

```bash
./scripts/deploy.sh staging
```

#### Deploy to Production

```bash
./scripts/deploy.sh prod
```

**Note**: Production deployments require additional confirmation prompts.

### Step 5: Retrieve Outputs

After deployment, CDK will output important values:

- Backend URL (ALB DNS)
- Frontend URL (CloudFront distribution)
- Database endpoint
- S3 bucket names
- Secret ARNs

Save these values for application configuration.

### Step 6: Configure Application

1. Retrieve database credentials:
```bash
aws secretsmanager get-secret-value \
  --secret-id multica-dev-db-credentials \
  --query SecretString \
  --output text | jq .
```

2. Retrieve JWT secret:
```bash
aws secretsmanager get-secret-value \
  --secret-id multica-dev-jwt-secret \
  --query SecretString \
  --output text | jq .
```

3. Deploy your application code to the EC2 instances (via SSH, CodeDeploy, or your CI/CD pipeline)

4. Build and deploy frontend:
```bash
# From the root of the Multica repository
cd apps/web
npm run build

# Upload to S3
aws s3 sync ./out s3://multica-web-dev-<account-id>/

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id <distribution-id> \
  --paths "/*"
```

## Infrastructure Components

### Network Stack

- **VPC**: Isolated network with configurable CIDR
- **Subnets**:
  - Public: For load balancers and NAT gateways
  - Private: For application servers
  - Isolated: For databases (no internet access)
- **NAT Gateway**: Enables outbound internet for private subnets
- **Security Groups**: Least-privilege access rules
- **VPC Flow Logs**: Network traffic monitoring

### Database Stack

- **RDS PostgreSQL 16**: Managed database service
- **Multi-AZ**: High availability (staging/prod)
- **Automated Backups**: 7-30 days retention
- **Encryption**: At-rest and in-transit
- **Performance Insights**: Query performance monitoring
- **CloudWatch Alarms**: CPU and storage monitoring
- **Secrets Manager**: Secure credential storage

### Backend Stack

- **Application Load Balancer**: Distributes traffic across instances
- **Auto Scaling Group**: 
  - Scales based on CPU and request count
  - Rolling updates with zero downtime
  - Health checks via ALB
- **EC2 Instances**: 
  - Latest Amazon Linux 2023
  - CloudWatch agent installed
  - SSM Session Manager enabled (no SSH keys needed)
- **IAM Roles**: Least-privilege permissions
- **S3 Bucket**: For application assets and backups

### Frontend Stack

- **S3 Bucket**: Static website hosting
- **CloudFront**: 
  - Global CDN for low latency
  - HTTPS enforcement
  - Custom cache policies for static/dynamic content
  - Origin Access Identity for S3 security
- **Access Logs**: Request logging to S3

## Cost Estimation

### Development Environment (Monthly)

| Service | Configuration | Estimated Cost |
|---------|--------------|----------------|
| EC2 (t3.small) | 1 instance, ~730 hours | $15 |
| RDS (db.t4g.micro) | 1 instance, 20GB storage | $15 |
| NAT Gateway | 1 gateway + data transfer | $35 |
| ALB | 1 load balancer | $20 |
| S3 | 10GB storage + requests | $2 |
| CloudFront | 50GB data transfer | $5 |
| CloudWatch Logs | 5GB ingested | $3 |
| **Total** | | **~$95/month** |

### Production Environment (Monthly)

| Service | Configuration | Estimated Cost |
|---------|--------------|----------------|
| EC2 (t3.large) | 3 instances, ~2190 hours | $140 |
| RDS (db.r6g.large) | 1 instance Multi-AZ, 100GB | $250 |
| NAT Gateway | 3 gateways + data transfer | $110 |
| ALB | 1 load balancer | $25 |
| S3 | 100GB storage + requests | $5 |
| CloudFront | 500GB data transfer | $40 |
| CloudWatch Logs | 50GB ingested | $25 |
| **Total** | | **~$595/month** |

**Notes**:
- Costs vary by region
- Data transfer costs depend on usage
- Prices are approximate and subject to change
- AWS Free Tier may reduce costs for new accounts

### Cost Optimization Tips

1. **Development**:
   - Use t4g (ARM) instances for 20% savings
   - Single NAT gateway instead of one per AZ
   - Smaller RDS instance types
   - Stop non-production resources during off-hours

2. **Production**:
   - Use Reserved Instances for 30-60% savings
   - Enable S3 Intelligent-Tiering
   - Use CloudFront compression
   - Set up CloudWatch log retention policies
   - Consider Aurora Serverless for variable workloads

## Monitoring and Logging

### CloudWatch Dashboards

Create custom dashboards to monitor:
- ALB metrics (request count, latency, errors)
- EC2 metrics (CPU, memory, disk)
- RDS metrics (connections, CPU, IOPS)
- Auto Scaling activity

### CloudWatch Alarms

Pre-configured alarms:
- Database CPU > 80%
- Database free storage < 5GB
- (Add more via CDK or AWS Console)

Recommended additional alarms:
- ALB 5xx errors
- RDS connection count
- EC2 instance status checks

### Log Aggregation

Logs are collected in CloudWatch:
- ALB access logs → S3
- Application logs → CloudWatch Logs (via CloudWatch agent)
- VPC Flow Logs → CloudWatch Logs
- RDS logs → CloudWatch Logs

## Security

### Network Security

- **Private subnets**: Application servers have no direct internet access
- **Security groups**: Whitelist-based, minimal port exposure
- **NACLs**: Default VPC network ACLs
- **VPC Flow Logs**: Audit network traffic

### Data Security

- **Encryption at rest**:
  - RDS: AES-256
  - S3: SSE-S3
  - EBS: Encrypted volumes
- **Encryption in transit**:
  - HTTPS/TLS for all public endpoints
  - PostgreSQL SSL connections
- **Secrets Management**: AWS Secrets Manager for sensitive data

### IAM Security

- **Least privilege**: Minimal permissions per role
- **No hardcoded credentials**: All credentials in Secrets Manager
- **Instance roles**: EC2 uses IAM roles, not access keys
- **MFA**: Recommended for AWS account root and admin users

### Compliance Features

- **CloudTrail**: API call auditing (enable separately)
- **Config**: Resource configuration tracking (enable separately)
- **GuardDuty**: Threat detection (enable separately)

## Troubleshooting

### Common Issues

#### CDK Bootstrap Fails

**Error**: "Unable to resolve AWS account"

**Solution**:
```bash
# Check AWS credentials
aws sts get-caller-identity

# Re-configure if needed
aws configure
```

#### Stack Deployment Fails

**Error**: "Resource creation failed"

**Solutions**:
1. Check CloudFormation events in AWS Console
2. Verify service quotas: `aws service-quotas list-service-quotas --service-code ec2`
3. Check for naming conflicts
4. Ensure sufficient permissions

#### CDK Diff Shows Unexpected Changes

**Solution**:
```bash
# View detailed differences
cdk diff --context environment=dev

# Check for context changes
cat cdk.context.json
```

#### Cannot Connect to Database

**Checklist**:
1. Security group allows traffic from backend
2. Database is in "available" state
3. Connection string is correct
4. SSL mode is configured (`sslmode=require`)

#### EC2 Instances Fail Health Checks

**Debugging**:
1. SSH/SSM into instance: `aws ssm start-session --target <instance-id>`
2. Check application logs: `sudo journalctl -u multica-backend.service`
3. Test health endpoint: `curl http://localhost:8080/health`
4. Check security group rules
5. Verify user data script executed: `cat /var/log/cloud-init-output.log`

#### CloudFront Returns 403 Errors

**Solutions**:
1. Check S3 bucket policy allows CloudFront OAI
2. Verify files exist in S3: `aws s3 ls s3://bucket-name/`
3. Check CloudFront origin settings
4. Review CloudFront error responses configuration

### Health Checks

#### Backend Health Check

```bash
# Via ALB
curl http://<alb-dns>/health

# Direct to instance (from within VPC)
curl http://<instance-private-ip>:8080/health
```

#### Database Connectivity Check

```bash
# From backend instance
psql "postgresql://username:password@db-endpoint:5432/multica?sslmode=require" -c "SELECT 1;"
```

#### Frontend Deployment Check

```bash
# Check CloudFront distribution status
aws cloudfront get-distribution --id <distribution-id>

# List S3 bucket contents
aws s3 ls s3://multica-web-dev-<account-id>/
```

## Rollback Procedures

### Rolling Back a Failed Deployment

#### Option 1: CloudFormation Automatic Rollback

CloudFormation automatically rolls back on failure. Monitor in the AWS Console.

#### Option 2: Manual Rollback

```bash
# List stack events
aws cloudformation describe-stack-events \
  --stack-name Multica-Backend-dev \
  --max-items 50

# If needed, update to previous version
cdk deploy --context environment=dev --rollback
```

#### Option 3: Redeploy Previous Version

```bash
# Checkout previous commit
git checkout <previous-commit-hash>

# Redeploy
./scripts/deploy.sh dev
```

### Disaster Recovery

#### Database Restoration

```bash
# List available snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier multica-database-dev

# Restore from snapshot (this is destructive!)
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier multica-database-dev-restored \
  --db-snapshot-identifier <snapshot-id>
```

#### Full Infrastructure Redeployment

```bash
# Destroy old infrastructure
./scripts/destroy.sh dev

# Redeploy from scratch
./scripts/deploy.sh dev
```

**Warning**: This is destructive and will result in data loss unless backups are properly restored.

## Maintenance

### Updating Dependencies

```bash
cd infrastructure

# Update CDK and dependencies
npm update

# Check for outdated packages
npm outdated

# Update to latest versions
npm install aws-cdk-lib@latest aws-cdk@latest
```

### Infrastructure Updates

When modifying infrastructure:

1. Make changes in CDK code
2. Test in dev environment first
3. Run `cdk diff` to preview changes
4. Deploy to dev, then staging, then prod
5. Monitor CloudWatch for any issues

### Database Maintenance

- **Backups**: Automatic daily backups retained per configuration
- **Patching**: RDS handles patches during maintenance window
- **Scaling**: Modify instance type in `config.ts` and redeploy

## Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [Multica Documentation](https://multica.ai/docs)
- [AWS Service Quotas](https://console.aws.amazon.com/servicequotas/)

## Support

For issues related to:
- **Infrastructure code**: Open an issue in this repository
- **AWS services**: Contact AWS Support
- **Multica application**: See main repository documentation

---

**Important**: Always test infrastructure changes in a non-production environment first. Never run `destroy` scripts on production without multiple confirmations and backups.
