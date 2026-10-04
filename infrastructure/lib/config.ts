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

// Development-focused configuration
// This configuration is optimized for cost and simplicity
// No NAT gateway - backend instances run in public subnets for ~$35/month savings
const devConfig: EnvironmentConfig = {
  environment: 'dev',

  // Network - 2 AZs for redundancy, no NAT gateway
  vpcCidr: '10.0.0.0/16',
  maxAzs: 2,

  // Database - Cost-optimized instance
  databaseInstanceType: 'db.t4g.micro',
  databaseAllocatedStorage: 20,
  databaseBackupRetention: 7,
  databaseMultiAz: false,
  databaseDeletionProtection: false,

  // Backend - Small instance for development
  backendInstanceType: 't3.small',
  backendMinCapacity: 1,
  backendMaxCapacity: 2,
  backendDesiredCapacity: 1,

  // Frontend
  frontendDomainName: undefined,
  frontendCertificateArn: undefined,

  // General - Minimal monitoring to reduce costs
  enableDetailedMonitoring: false,
  enableEnhancedMonitoring: false,
};

export function getConfig(environment: string = 'dev'): EnvironmentConfig {
  // Currently only supporting development environment
  // For production deployments, extend this configuration
  if (environment !== 'dev') {
    console.warn(`Warning: Only 'dev' environment is currently configured. Using dev configuration.`);
  }
  return devConfig;
}
