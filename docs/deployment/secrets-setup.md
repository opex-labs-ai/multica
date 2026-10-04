# GitHub Secrets Setup Guide

Step-by-step guide for configuring GitHub Secrets required for Multica deployment workflows.

## Prerequisites

- Repository admin access
- AWS account with appropriate permissions
- AWS CLI configured

## Setup Steps

### 1. Configure OIDC Provider in AWS

First, set up GitHub Actions as an OIDC identity provider in AWS:

```bash
# Create the OIDC provider
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 2. Create IAM Roles

Create separate IAM roles for each environment (dev, staging, production).

#### Development Role

```bash
# Create trust policy file
cat > trust-policy-dev.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
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
EOF

# Create the role
aws iam create-role \
  --role-name GitHubActions-Multica-Dev \
  --assume-role-policy-document file://trust-policy-dev.json

# Attach policies
aws iam attach-role-policy \
  --role-name GitHubActions-Multica-Dev \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMFullAccess

aws iam attach-role-policy \
  --role-name GitHubActions-Multica-Dev \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
```

#### Custom Deployment Policy

Create a custom policy with minimal required permissions:

```bash
cat > deployment-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:SendCommand",
        "ssm:GetCommandInvocation",
        "ssm:ListCommandInvocations"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeInstanceStatus"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/multica/*"
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name MulticaDeploymentPolicy \
  --policy-document file://deployment-policy.json

aws iam attach-role-policy \
  --role-name GitHubActions-Multica-Dev \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/MulticaDeploymentPolicy
```

Repeat for staging and production roles.

### 3. Configure GitHub Secrets

#### Navigate to Repository Settings

1. Go to your repository: `https://github.com/opex-labs-ai/multica`
2. Click **Settings**
3. Click **Secrets and variables** → **Actions**

#### Add Repository Secrets

Click **New repository secret** for each of the following:

##### Global Secrets

| Secret Name | Value | How to Get |
|-------------|-------|------------|
| `AWS_REGION` | `us-east-1` | Your AWS region |

##### Development Environment Secrets

Click **New environment** and create `dev`, then add these secrets:

| Secret Name | Value | How to Get |
|-------------|-------|------------|
| `AWS_ROLE_ARN_DEV` | `arn:aws:iam::ACCOUNT_ID:role/GitHubActions-Multica-Dev` | From IAM console |
| `EC2_INSTANCE_ID_DEV` | `i-0123456789abcdef0` | From EC2 console |
| `DEV_API_URL` | `https://dev-api.multica.example.com` | Your dev API URL |
| `DEV_WS_URL` | `wss://dev-api.multica.example.com/ws` | Your dev WebSocket URL |

##### Staging Environment Secrets

Create `staging` environment and add:

| Secret Name | Value |
|-------------|-------|
| `AWS_ROLE_ARN_STAGING` | `arn:aws:iam::ACCOUNT_ID:role/GitHubActions-Multica-Staging` |
| `EC2_INSTANCE_ID_STAGING` | `i-0123456789abcdef0` |
| `STAGING_API_URL` | `https://staging-api.multica.example.com` |
| `STAGING_WS_URL` | `wss://staging-api.multica.example.com/ws` |

##### Production Environment Secrets

Create `production` environment and add:

| Secret Name | Value | Notes |
|-------------|-------|-------|
| `AWS_ROLE_ARN_PROD` | `arn:aws:iam::ACCOUNT_ID:role/GitHubActions-Multica-Prod` | |
| `EC2_INSTANCE_IDS_PROD` | `i-abc123,i-def456,i-ghi789` | Comma-separated for rolling deployment |
| `PROD_API_URL` | `https://api.multica.example.com` | |
| `PROD_WS_URL` | `wss://api.multica.example.com/ws` | |

### 4. Configure Environment Protection Rules

For production environment:

1. Go to **Settings** → **Environments** → **production**
2. Check **Required reviewers**
3. Add team members who can approve production deployments
4. Set **Wait timer** if desired (e.g., 5 minutes)
5. Click **Save protection rules**

### 5. Verify Configuration

Test that the secrets are configured correctly:

```bash
# Trigger a test deployment to dev
gh workflow run deploy-backend.yml -f environment=dev
```

Monitor the workflow run in the Actions tab.

## Secret Rotation

Rotate secrets regularly for security:

### Rotating IAM Role Credentials

IAM roles use temporary credentials that are automatically rotated. No manual rotation needed.

### Rotating Application Secrets

If you have application-level secrets (API keys, tokens):

1. Generate new secret value
2. Update GitHub Secret
3. Deploy to update running containers
4. Verify deployment successful
5. Revoke old secret

## Troubleshooting

### "Unable to assume role" error

**Solution:**
- Verify the trust policy includes the correct repository
- Check that OIDC provider exists in IAM
- Ensure the role ARN in GitHub Secrets is correct

```bash
# Check OIDC provider
aws iam list-open-id-connect-providers

# Check trust policy
aws iam get-role --role-name GitHubActions-Multica-Dev
```

### "Access denied" when running SSM commands

**Solution:**
- Verify the IAM role has `AmazonSSMFullAccess` or equivalent
- Check EC2 instance has SSM agent running
- Verify instance has an IAM instance profile attached

```bash
# Check instance profile
aws ec2 describe-instances \
  --instance-ids i-1234567890abcdef0 \
  --query 'Reservations[].Instances[].IamInstanceProfile'

# Attach instance profile if missing
aws ec2 associate-iam-instance-profile \
  --instance-id i-1234567890abcdef0 \
  --iam-instance-profile Name=SSMManagedInstance
```

### Environment secrets not available

**Solution:**
- Ensure you created the environment in GitHub (not just repository secrets)
- Verify the workflow references the correct environment name
- Check that you have admin access to the repository

## Security Recommendations

1. **Use environment protection rules** - Require approvals for production
2. **Limit secret access** - Only give access to those who need it
3. **Audit secret usage** - Review CloudTrail logs regularly
4. **Rotate secrets** - Set up a rotation schedule
5. **Use temporary credentials** - Always prefer IAM roles over access keys
6. **Monitor for leaks** - Use secret scanning tools

## References

- [GitHub OIDC with AWS](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [AWS IAM Roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)
- [GitHub Encrypted Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)

---

**Last Updated:** 2026-10-04
