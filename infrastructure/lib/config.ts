export interface EnvironmentConfig {
  environment: string;

  // Network Configuration
  vpcCidr: string;
  maxAzs: number;

  // Database Configuration
  databaseInstanceType: string;
  databaseAllocatedStorage: number;
  databaseBackupRetention: number;
  databaseMultiAz: boolean;
  databaseDeletionProtection: boolean;

  // Backend Configuration
  backendInstanceType: string;
  backendMinCapacity: number;
  backendMaxCapacity: number;
  backendDesiredCapacity: number;

  // Frontend Configuration
  frontendDomainName?: string;
  frontendCertificateArn?: string;

  // General
  enableDetailedMonitoring: boolean;
  enableEnhancedMonitoring: boolean;
}

const configurations: Record<string, EnvironmentConfig> = {
  dev: {
    environment: 'dev',

    // Network
    vpcCidr: '10.0.0.0/16',
    maxAzs: 2,

    // Database - Small instance for dev
    databaseInstanceType: 'db.t4g.micro',
    databaseAllocatedStorage: 20,
    databaseBackupRetention: 7,
    databaseMultiAz: false,
    databaseDeletionProtection: false,

    // Backend - Small instance for dev
    backendInstanceType: 't3.small',
    backendMinCapacity: 1,
    backendMaxCapacity: 2,
    backendDesiredCapacity: 1,

    // Frontend
    frontendDomainName: undefined,
    frontendCertificateArn: undefined,

    // General
    enableDetailedMonitoring: false,
    enableEnhancedMonitoring: false,
  },

  staging: {
    environment: 'staging',

    // Network
    vpcCidr: '10.1.0.0/16',
    maxAzs: 2,

    // Database - Medium instance for staging
    databaseInstanceType: 'db.t4g.small',
    databaseAllocatedStorage: 50,
    databaseBackupRetention: 14,
    databaseMultiAz: true,
    databaseDeletionProtection: true,

    // Backend - Medium instance for staging
    backendInstanceType: 't3.medium',
    backendMinCapacity: 2,
    backendMaxCapacity: 4,
    backendDesiredCapacity: 2,

    // Frontend
    frontendDomainName: undefined,
    frontendCertificateArn: undefined,

    // General
    enableDetailedMonitoring: true,
    enableEnhancedMonitoring: true,
  },

  prod: {
    environment: 'prod',

    // Network
    vpcCidr: '10.2.0.0/16',
    maxAzs: 3,

    // Database - Production-grade instance
    databaseInstanceType: 'db.r6g.large',
    databaseAllocatedStorage: 100,
    databaseBackupRetention: 30,
    databaseMultiAz: true,
    databaseDeletionProtection: true,

    // Backend - Production-grade instances
    backendInstanceType: 't3.large',
    backendMinCapacity: 3,
    backendMaxCapacity: 10,
    backendDesiredCapacity: 3,

    // Frontend
    frontendDomainName: undefined, // Set this to your domain name
    frontendCertificateArn: undefined, // Set this to your ACM certificate ARN

    // General
    enableDetailedMonitoring: true,
    enableEnhancedMonitoring: true,
  },
};

export function getConfig(environment: string): EnvironmentConfig {
  const config = configurations[environment];
  if (!config) {
    throw new Error(`Unknown environment: ${environment}. Valid environments: ${Object.keys(configurations).join(', ')}`);
  }
  return config;
}
