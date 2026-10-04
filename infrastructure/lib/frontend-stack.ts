import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { EnvironmentConfig } from './config';

interface FrontendStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  backendUrl: string;
}

export class FrontendStack extends cdk.Stack {
  public readonly distributionDomain: string;
  public readonly websiteBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { config, backendUrl } = props;

    // S3 bucket for static website hosting
    this.websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `multica-web-${config.environment}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: config.environment === 'prod',
      removalPolicy: config.environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.environment !== 'prod',
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
    });

    // CloudFront Origin Access Identity
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: `OAI for Multica ${config.environment} website`,
    });

    // Grant CloudFront read access to S3 bucket
    this.websiteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [this.websiteBucket.arnForObjects('*')],
        principals: [
          new iam.CanonicalUserPrincipal(
            originAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId
          ),
        ],
      })
    );

    // CloudFront cache policy for static assets
    const staticCachePolicy = new cloudfront.CachePolicy(this, 'StaticCachePolicy', {
      cachePolicyName: `multica-static-${config.environment}`,
      comment: 'Cache policy for static assets',
      defaultTtl: cdk.Duration.days(7),
      minTtl: cdk.Duration.seconds(1),
      maxTtl: cdk.Duration.days(365),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    });

    // CloudFront cache policy for dynamic content
    const dynamicCachePolicy = new cloudfront.CachePolicy(this, 'DynamicCachePolicy', {
      cachePolicyName: `multica-dynamic-${config.environment}`,
      comment: 'Cache policy for dynamic content',
      defaultTtl: cdk.Duration.seconds(0),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.days(1),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
        'Authorization',
        'CloudFront-Viewer-Country',
        'Accept',
        'Accept-Language'
      ),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      cookieBehavior: cloudfront.CacheCookieBehavior.all(),
    });

    // Origin request policy
    const originRequestPolicy = new cloudfront.OriginRequestPolicy(
      this,
      'OriginRequestPolicy',
      {
        originRequestPolicyName: `multica-origin-${config.environment}`,
        comment: 'Policy to forward all headers, cookies, and query strings',
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.all(),
        queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
        cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
      }
    );

    // CloudFront Distribution
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Multica ${config.environment} distribution`,
      defaultRootObject: 'index.html',
      priceClass: config.environment === 'prod'
        ? cloudfront.PriceClass.PRICE_CLASS_ALL
        : cloudfront.PriceClass.PRICE_CLASS_100,
      enableLogging: true,
      logBucket: new s3.Bucket(this, 'LogBucket', {
        bucketName: `multica-logs-${config.environment}-${this.account}`,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        lifecycleRules: [
          {
            id: 'DeleteOldLogs',
            enabled: true,
            expiration: cdk.Duration.days(90),
          },
        ],
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      }),
      logFilePrefix: 'cloudfront/',
      defaultBehavior: {
        origin: new origins.S3Origin(this.websiteBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: dynamicCachePolicy,
      },
      additionalBehaviors: {
        // Static assets (JS, CSS, images) with long cache
        '_next/static/*': {
          origin: new origins.S3Origin(this.websiteBucket, {
            originAccessIdentity,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: staticCachePolicy,
          compress: true,
        },
        'static/*': {
          origin: new origins.S3Origin(this.websiteBucket, {
            originAccessIdentity,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: staticCachePolicy,
          compress: true,
        },
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
    });

    this.distributionDomain = distribution.distributionDomainName;

    // Outputs
    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: this.websiteBucket.bucketName,
      description: 'S3 bucket for website files',
      exportName: `${config.environment}-WebsiteBucket`,
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID',
      exportName: `${config.environment}-DistributionId`,
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distributionDomain,
      description: 'CloudFront distribution domain name',
      exportName: `${config.environment}-DistributionDomain`,
    });

    new cdk.CfnOutput(this, 'WebsiteURL', {
      value: `https://${this.distributionDomain}`,
      description: 'Website URL',
    });

    new cdk.CfnOutput(this, 'DeployCommand', {
      value: `aws s3 sync ./apps/web/out s3://${this.websiteBucket.bucketName}/ && aws cloudfront create-invalidation --distribution-id ${distribution.distributionId} --paths "/*"`,
      description: 'Command to deploy frontend (after building)',
    });
  }
}
