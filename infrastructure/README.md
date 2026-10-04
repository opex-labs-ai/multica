# Multica AWS CDK Infrastructure (Development)

AWS CDK infrastructure code for deploying the Multica platform to AWS in a development environment. This setup is optimized for cost-efficiency and ease of deployment.

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Infrastructure Components](#infrastructure-components)
- [Cost Estimation](#cost-estimation)
- [Monitoring](#monitoring)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

## Architecture

```mermaid
graph TB
    subgraph "AWS Cloud - Development Environment"
        subgraph "Public Subnets"
            ALB[Application Load Balancer]
            ASG[Auto Scaling Group<br/>Backend EC2 Instance<br/>t3.small]
        end
        
        subgraph "Isolated Subnets"
            RDS[(RDS PostgreSQL 16<br/>db.t4g.micro<br/>20GB)]
        end
        
        CF[CloudFront CDN] --> S3[S3 Bucket<br/>Frontend Static Files]
        
        Internet((Internet)) --> CF
        Internet --> ALB
        
        ALB --> ASG
        ASG --> RDS
        ASG --> S3Assets[S3 Assets Bucket]
        
        ASG --> Secrets[AWS Secrets Manager<br/>DB & JWT Secrets]
        
        CloudWatch[CloudWatch<br/>Logs & Metrics]
        ASG --> CloudWatch
        RDS --> CloudWatch
    end
    
    Users[Users] --> Internet
    
    style ASG fill:#ff9900
    style ALB fill:#ff9900
    style RDS fill:#3b48cc
```

### Key Components

1. **Network Stack**: VPC with public and isolated subnets across 2 AZs (no NAT gateway)
2. **Database Stack**: RDS PostgreSQL 16 (db.t4g.micro, 20GB)
3. **Backend Stack**: EC2 Auto Scaling Group (t3.small) in public subnets behind ALB
4. **Frontend Stack**: S3 + CloudFront CDN for static hosting

## Prerequisites

### Required Software

- **Node.js** 22 or higher
  ```bash
  node --version  # Should be 22+
  ```

- **AWS CLI** v2
  ```bash
  aws --version
  ```
  Install: https://aws.amazon.com/cli/

- **AWS CDK CLI**
  ```bash
  npm install -g aws-cdk
  cdk --version
  ```

### AWS Account

- An AWS account with appropriate permissions
- AWS credentials configured via `aws configure`

## Quick Start

### 1. Configure AWS Credentials

```bash
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Enter your default region (e.g., us-east-1)
```

Verify:
```bash
aws sts get-caller-identity
```

### 2. Bootstrap CDK (One-time setup)

```bash
cd infrastructure
./scripts/bootstrap.sh
```

### 3. Review Configuration

The default development configuration in `lib/config.ts`:
- VPC: 10.0.0.0/16 across 2 AZs (no NAT gateway for cost savings)
- Database: db.t4g.micro with 20GB storage
- Backend: t3.small EC2 instances in public subnets (min 1, max 2)

### 4. Preview Changes

```bash
npm run synth  # Generate CloudFormation templates
npm run diff   # Show what will be deployed
```

### 5. Deploy

```bash
./scripts/deploy.sh
```

Or using npm:
```bash
npm run deploy
```

This will create:
- 4 CloudFormation stacks (Network, Database, Backend, Frontend)
- All necessary AWS resources
- Estimated time: 15-20 minutes

### 6. Get Outputs

After deployment, note the outputs:
- Backend URL (ALB DNS)
- Frontend URL (CloudFront distribution)
- Database endpoint
- S3 bucket names

## Configuration

All configuration is in `lib/config.ts`. The development setup uses:

```typescript
{
  // Network
  vpcCidr: '10.0.0.0/16',
  maxAzs: 2,
  
  // Database
  databaseInstanceType: 'db.t4g.micro',
  databaseAllocatedStorage: 20,
  databaseMultiAz: false,
  
  // Backend
  backendInstanceType: 't3.small',
  backendMinCapacity: 1,
  backendMaxCapacity: 2,
  
  // Monitoring (disabled for cost)
  enableDetailedMonitoring: false,
  enableEnhancedMonitoring: false,
}
```

### Customizing Configuration

Edit `lib/config.ts` to adjust instance types, storage, or capacity:

```typescript
const devConfig: EnvironmentConfig = {
  // Increase database storage
  databaseAllocatedStorage: 50,
  
  // Use larger backend instance
  backendInstanceType: 't3.medium',
  
  // ... other settings
};
```

After changes, run `npm run deploy` to update.

## Deployment

### Deploy All Stacks

```bash
./scripts/deploy.sh
```

### Deploy Specific Stack

```bash
cdk deploy Multica-Network-dev
cdk deploy Multica-Database-dev
cdk deploy Multica-Backend-dev
cdk deploy Multica-Frontend-dev
```

### Update After Code Changes

```bash
npm run diff    # Preview changes
npm run deploy  # Apply changes
```

## Infrastructure Components

### Network Stack

- **VPC**: 10.0.0.0/16 with DNS support enabled
- **Subnets**: 
  - Public subnets for ALB and backend instances
  - Isolated subnets for database (no internet access)
- **No NAT Gateway**: Backend in public subnets for direct internet access and cost savings (~$35/month)
- **Security Groups**: 
  - ALB: Allows HTTP/HTTPS from internet
  - Backend: Allows traffic from ALB only
  - Database: Allows PostgreSQL from backend only
- **VPC Flow Logs**: Network traffic monitoring

### Database Stack

- **RDS PostgreSQL 16** on db.t4g.micro
- **Storage**: 20GB GP3, auto-scales to 40GB if needed
- **Backups**: Automated daily backups, 7-day retention
- **Encryption**: At-rest encryption enabled
- **Monitoring**: CloudWatch alarms for CPU and storage
- **Credentials**: Stored in AWS Secrets Manager

### Backend Stack

- **Application Load Balancer**: Internet-facing, HTTP/HTTPS
- **Auto Scaling Group**:
  - Min: 1 instance
  - Max: 2 instances
  - Scales on CPU (70%) and request count
- **EC2 Instances**:
  - Type: t3.small
  - AMI: Amazon Linux 2023
  - 30GB GP3 EBS volume
- **Health Checks**: Via ALB at `/health` endpoint
- **IAM Role**: Access to Secrets Manager and S3
- **SSM Session Manager**: No SSH keys needed

### Frontend Stack

- **S3 Bucket**: Static website hosting
- **CloudFront**: Global CDN with:
  - HTTPS enforcement
  - Custom cache policies
  - Gzip/Brotli compression
  - Origin Access Identity for S3 security
- **Access Logs**: CloudFront logs to S3

## Cost Estimation

### Monthly Costs (Development)

| Service | Configuration | Monthly Cost |
|---------|--------------|--------------|
| EC2 | 1x t3.small (~730h) | $15 |
| RDS | 1x db.t4g.micro + 20GB | $15 |
| ALB | Application Load Balancer | $20 |
| S3 | 10GB storage + requests | $2 |
| CloudFront | 50GB transfer | $5 |
| CloudWatch | 5GB logs | $3 |
| **Total** | | **~$60/month** |

**Cost savings**: No NAT Gateway saves ~$35/month compared to typical configurations.

**Note**: Actual costs vary based on:
- Data transfer amounts
- Request volumes
- Region pricing
- AWS Free Tier eligibility (first year)

### Cost Optimization Tips

1. **Stop resources when not in use**:
   ```bash
   # Stop EC2 instances after hours
   aws ec2 stop-instances --instance-ids <instance-id>
   
   # Stop RDS database
   aws rds stop-db-instance --db-instance-identifier <db-name>
   ```

2. **Use AWS Free Tier** (first 12 months):
   - 750 hours t2.micro/t3.micro EC2
   - 750 hours db.t2.micro/db.t3.micro RDS
   - 5GB S3 storage

3. **Destroy when not needed**:
   ```bash
   ./scripts/destroy.sh
   ```

## Monitoring

### CloudWatch Dashboards

View metrics in AWS Console:
- EC2: CPU, network, disk
- RDS: Connections, CPU, IOPS
- ALB: Request count, latency, errors

### CloudWatch Alarms

Pre-configured alarms:
- Database CPU > 80%
- Database storage < 5GB free

### Logs

Collected in CloudWatch Logs:
- Application logs (via CloudWatch agent)
- VPC Flow Logs
- ALB access logs
- RDS PostgreSQL logs

## Security

### Network Security

- **Private subnets**: Backend has no direct internet access
- **Security groups**: Whitelist-based, minimal exposure
- **HTTPS**: CloudFront enforces HTTPS for frontend

### Data Security

- **Encryption at rest**: RDS, S3, EBS all encrypted
- **Encryption in transit**: TLS/SSL for all connections
- **Secrets**: Database and JWT secrets in Secrets Manager
- **IAM**: Least-privilege roles, no hardcoded credentials

### Access Control

- **SSM Session Manager**: Secure instance access without SSH keys
- **S3**: Bucket policies prevent public access
- **CloudFront OAI**: Only CloudFront can read S3 files

## Troubleshooting

### Common Issues

#### CDK Bootstrap Fails

```bash
# Check credentials
aws sts get-caller-identity

# Re-configure AWS CLI
aws configure
```

#### Deployment Fails

Check CloudFormation console for specific errors:
```bash
aws cloudformation describe-stack-events --stack-name Multica-Network-dev
```

Common causes:
- Insufficient IAM permissions
- Service quota limits reached
- Resource naming conflicts

#### Cannot Access Application

1. Check EC2 instances are running
2. Verify security group rules
3. Check ALB target health:
   ```bash
   aws elbv2 describe-target-health --target-group-arn <tg-arn>
   ```

#### Database Connection Fails

1. Check security group allows traffic from backend
2. Verify database is "available" state
3. Test from EC2 instance:
   ```bash
   # Get credentials from Secrets Manager first
   psql "postgresql://user:pass@endpoint:5432/multica?sslmode=require"
   ```

### Health Checks

#### Backend Health

```bash
# Via ALB
curl http://<alb-dns>/health

# Direct (from inside VPC)
aws ssm start-session --target <instance-id>
curl http://localhost:8080/health
```

#### Database Check

```bash
aws rds describe-db-instances --db-instance-identifier <db-name>
```

### Getting Help

1. Check CloudFormation events in AWS Console
2. Review CloudWatch Logs
3. Check CDK output for error messages
4. Verify all prerequisites are met

## Updating Infrastructure

### Modify Configuration

1. Edit `lib/config.ts`
2. Preview changes: `npm run diff`
3. Apply changes: `npm run deploy`

### Update Dependencies

```bash
cd infrastructure
npm update
npm install aws-cdk-lib@latest aws-cdk@latest
```

## Destroying Infrastructure

**Warning**: This deletes all resources and data!

```bash
./scripts/destroy.sh
```

Or using npm:
```bash
npm run destroy
```

The database will be deleted (no final snapshot in dev).

## Application Deployment

After infrastructure is deployed:

### 1. Retrieve Secrets

```bash
# Database credentials
aws secretsmanager get-secret-value \
  --secret-id multica-dev-db-credentials \
  --query SecretString --output text | jq .

# JWT secret
aws secretsmanager get-secret-value \
  --secret-id multica-dev-jwt-secret \
  --query SecretString --output text | jq .
```

### 2. Deploy Backend

SSH into EC2 instance via SSM:
```bash
aws ssm start-session --target <instance-id>
```

Then deploy your Go application.

### 3. Deploy Frontend

Build and upload to S3:
```bash
cd apps/web
npm run build

# Upload to S3
aws s3 sync ./out s3://<bucket-name>/

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id <dist-id> \
  --paths "/*"
```

## Next Steps

- Set up CI/CD pipeline for automated deployments
- Configure custom domain name with Route 53
- Enable CloudTrail for audit logging
- Set up SNS alerts for CloudWatch alarms
- Configure automated backups to separate S3 bucket

## Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Multica Documentation](https://multica.ai/docs)
- [AWS Free Tier](https://aws.amazon.com/free/)
- [AWS Pricing Calculator](https://calculator.aws/)

---

**Note**: This infrastructure is configured for development use. For production deployments, consider adding:
- Multi-AZ database replication
- Larger instance types
- Enhanced monitoring
- Additional security controls
- Disaster recovery procedures
