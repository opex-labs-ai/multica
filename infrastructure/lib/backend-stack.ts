import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { EnvironmentConfig } from './config';

interface BackendStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  database: rds.DatabaseInstance;
  config: EnvironmentConfig;
}

export class BackendStack extends cdk.Stack {
  public readonly backendUrl: string;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);

    const { vpc, database, config } = props;

    // Create S3 bucket for application assets and backups
    const assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
      bucketName: `multica-assets-${config.environment}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: config.environment === 'prod',
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: config.environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.environment !== 'prod',
    });

    // Create JWT secret
    const jwtSecret = new secretsmanager.Secret(this, 'JWTSecret', {
      secretName: `multica-${config.environment}-jwt-secret`,
      generateSecretString: {
        generateStringKey: 'secret',
        secretStringTemplate: JSON.stringify({}),
        excludePunctuation: true,
        passwordLength: 64,
      },
      description: 'Multica JWT signing secret',
    });

    // Security Group for Backend
    const backendSecurityGroup = new ec2.SecurityGroup(this, 'BackendSecurityGroup', {
      vpc,
      description: 'Security group for Multica backend instances',
      allowAllOutbound: true,
    });

    // Security Group for ALB
    const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc,
      description: 'Security group for Application Load Balancer',
      allowAllOutbound: true,
    });

    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP from internet'
    );

    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS from internet'
    );

    // Allow ALB to reach backend
    backendSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(8080),
      'Allow traffic from ALB'
    );

    // Allow backend to reach database
    database.connections.allowFrom(
      backendSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow backend to connect to database'
    );

    // IAM Role for Backend EC2 instances
    const backendRole = new iam.Role(this, 'BackendRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'IAM role for Multica backend EC2 instances',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // Grant access to secrets
    database.secret!.grantRead(backendRole);
    jwtSecret.grantRead(backendRole);

    // Grant S3 access
    assetsBucket.grantReadWrite(backendRole);

    // User data script for backend initialization
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -e',
      '',
      '# Update system',
      'yum update -y',
      '',
      '# Install CloudWatch agent',
      'wget https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm',
      'rpm -U ./amazon-cloudwatch-agent.rpm',
      '',
      '# Install AWS CLI v2',
      'curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"',
      'unzip awscliv2.zip',
      './aws/install',
      '',
      '# Install Docker',
      'yum install -y docker',
      'systemctl start docker',
      'systemctl enable docker',
      'usermod -a -G docker ec2-user',
      '',
      '# Install Docker Compose',
      'curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose',
      'chmod +x /usr/local/bin/docker-compose',
      '',
      '# Retrieve database credentials from Secrets Manager',
      `export DB_SECRET=$(aws secretsmanager get-secret-value --secret-id ${database.secret!.secretArn} --query SecretString --output text --region ${this.region})`,
      'export DB_USERNAME=$(echo $DB_SECRET | jq -r .username)',
      'export DB_PASSWORD=$(echo $DB_SECRET | jq -r .password)',
      `export DB_HOST=${database.dbInstanceEndpointAddress}`,
      `export DB_PORT=${database.dbInstanceEndpointPort}`,
      'export DB_NAME=multica',
      '',
      '# Retrieve JWT secret',
      `export JWT_SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id ${jwtSecret.secretArn} --query SecretString --output text --region ${this.region})`,
      'export JWT_SECRET=$(echo $JWT_SECRET_JSON | jq -r .secret)',
      '',
      '# Create application directory',
      'mkdir -p /opt/multica',
      'cd /opt/multica',
      '',
      '# Note: The actual application deployment should be done via CI/CD',
      '# This user data provides the base setup',
      '# You would typically:',
      '# 1. Pull the Docker image from ECR',
      '# 2. Or clone the repository and build',
      '# 3. Set environment variables',
      '# 4. Start the application',
      '',
      '# Create a placeholder systemd service',
      'cat > /etc/systemd/system/multica-backend.service << EOF',
      '[Unit]',
      'Description=Multica Backend Service',
      'After=docker.service',
      'Requires=docker.service',
      '',
      '[Service]',
      'Type=simple',
      'Restart=always',
      'RestartSec=10',
      'WorkingDirectory=/opt/multica',
      'Environment="DATABASE_URL=postgres://$DB_USERNAME:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?sslmode=require"',
      'Environment="JWT_SECRET=$JWT_SECRET"',
      'Environment="PORT=8080"',
      `Environment="APP_ENV=${config.environment}"`,
      `Environment="AWS_REGION=${this.region}"`,
      `Environment="S3_BUCKET=${assetsBucket.bucketName}"`,
      '# ExecStart=/usr/local/bin/docker-compose up',
      'ExecStart=/bin/echo "Placeholder - Configure actual start command"',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      'EOF',
      '',
      '# Enable the service (but don\'t start until app is deployed)',
      'systemctl daemon-reload',
      '# systemctl enable multica-backend.service',
      '',
      '# Signal CloudFormation that instance is ready',
      `/opt/aws/bin/cfn-signal -e $? --stack ${this.stackName} --resource BackendASG --region ${this.region}`,
    );

    // Application Load Balancer
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'BackendALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // Target Group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'BackendTargetGroup', {
      vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        enabled: true,
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // HTTP Listener (redirect to HTTPS in production)
    const httpListener = this.loadBalancer.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.forward([targetGroup]),
    });

    // Launch Template for Auto Scaling
    const launchTemplate = new ec2.LaunchTemplate(this, 'BackendLaunchTemplate', {
      instanceType: new ec2.InstanceType(config.backendInstanceType),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.X86_64,
      }),
      securityGroup: backendSecurityGroup,
      role: backendRole,
      userData,
      detailedMonitoring: config.enableDetailedMonitoring,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(30, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
    });

    // Auto Scaling Group (in public subnets since no NAT gateway)
    const asg = new autoscaling.AutoScalingGroup(this, 'BackendASG', {
      vpc,
      launchTemplate,
      minCapacity: config.backendMinCapacity,
      maxCapacity: config.backendMaxCapacity,
      desiredCapacity: config.backendDesiredCapacity,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      healthCheck: autoscaling.HealthCheck.elb({
        grace: cdk.Duration.minutes(5),
      }),
      updatePolicy: autoscaling.UpdatePolicy.rollingUpdate({
        maxBatchSize: 1,
        minInstancesInService: config.backendMinCapacity,
        pauseTime: cdk.Duration.minutes(5),
      }),
    });

    // Attach ASG to target group
    asg.attachToApplicationTargetGroup(targetGroup);

    // Auto Scaling policies
    asg.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
    });

    asg.scaleOnRequestCount('RequestCountScaling', {
      targetRequestsPerMinute: 1000,
    });

    // Backend URL
    this.backendUrl = `http://${this.loadBalancer.loadBalancerDnsName}`;

    // Outputs
    new cdk.CfnOutput(this, 'BackendURL', {
      value: this.backendUrl,
      description: 'Backend API URL',
      exportName: `${config.environment}-BackendURL`,
    });

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: this.loadBalancer.loadBalancerDnsName,
      description: 'Application Load Balancer DNS name',
    });

    new cdk.CfnOutput(this, 'AssetsBucketName', {
      value: assetsBucket.bucketName,
      description: 'S3 bucket for assets',
      exportName: `${config.environment}-AssetsBucket`,
    });

    new cdk.CfnOutput(this, 'JWTSecretArn', {
      value: jwtSecret.secretArn,
      description: 'JWT secret ARN',
    });
  }
}
