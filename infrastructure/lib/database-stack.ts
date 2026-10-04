import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { EnvironmentConfig } from './config';

interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  config: EnvironmentConfig;
}

export class DatabaseStack extends cdk.Stack {
  public readonly database: rds.DatabaseInstance;
  public readonly databaseSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { vpc, config } = props;

    // Create database credentials secret
    this.databaseSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: `multica-${config.environment}-db-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'multica' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
      description: 'Multica PostgreSQL database credentials',
    });

    // Security Group for Database
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Security group for Multica RDS PostgreSQL',
      allowAllOutbound: false,
    });

    // Subnet group for database (isolated subnets)
    const subnetGroup = new rds.SubnetGroup(this, 'DatabaseSubnetGroup', {
      description: 'Subnet group for Multica database',
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
    });

    // Parameter group for PostgreSQL tuning
    const parameterGroup = new rds.ParameterGroup(this, 'DatabaseParameterGroup', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      description: 'Parameter group for Multica PostgreSQL',
      parameters: {
        'shared_preload_libraries': 'pg_stat_statements',
        'max_connections': '200',
        'work_mem': '16384', // 16MB
      },
    });

    // Create RDS PostgreSQL instance
    this.database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: new ec2.InstanceType(config.databaseInstanceType),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [dbSecurityGroup],
      subnetGroup,
      parameterGroup,
      credentials: rds.Credentials.fromSecret(this.databaseSecret),
      databaseName: 'multica',
      allocatedStorage: config.databaseAllocatedStorage,
      maxAllocatedStorage: config.databaseAllocatedStorage * 2,
      storageType: rds.StorageType.GP3,
      multiAz: config.databaseMultiAz,
      deletionProtection: config.databaseDeletionProtection,
      backupRetention: cdk.Duration.days(config.databaseBackupRetention),
      preferredBackupWindow: '03:00-04:00',
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
      enablePerformanceInsights: config.enableEnhancedMonitoring,
      performanceInsightRetention: config.enableEnhancedMonitoring
        ? rds.PerformanceInsightRetention.DEFAULT
        : undefined,
      monitoringInterval: config.enableEnhancedMonitoring
        ? cdk.Duration.seconds(60)
        : undefined,
      cloudwatchLogsExports: ['postgresql', 'upgrade'],
      storageEncrypted: true,
      removalPolicy: config.environment === 'prod'
        ? cdk.RemovalPolicy.SNAPSHOT
        : cdk.RemovalPolicy.DESTROY,
    });

    // Allow connection from backend security group (will be added by backend stack)
    dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from VPC'
    );

    // CloudWatch Alarms for monitoring
    this.database.metricCPUUtilization().createAlarm(this, 'DatabaseCPUAlarm', {
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      alarmDescription: 'Database CPU utilization is too high',
    });

    this.database.metricFreeStorageSpace().createAlarm(this, 'DatabaseStorageAlarm', {
      threshold: 5 * 1024 * 1024 * 1024, // 5 GB
      comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      alarmDescription: 'Database free storage space is low',
    });

    // Outputs
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.database.dbInstanceEndpointAddress,
      description: 'Database endpoint address',
      exportName: `${config.environment}-DatabaseEndpoint`,
    });

    new cdk.CfnOutput(this, 'DatabasePort', {
      value: this.database.dbInstanceEndpointPort,
      description: 'Database port',
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: this.databaseSecret.secretArn,
      description: 'Database credentials secret ARN',
      exportName: `${config.environment}-DatabaseSecretArn`,
    });

    new cdk.CfnOutput(this, 'DatabaseName', {
      value: 'multica',
      description: 'Database name',
    });
  }
}
