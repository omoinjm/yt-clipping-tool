import { CfnOutput, Duration, RemovalPolicy, SecretValue, Size, Stack, type StackProps } from "aws-cdk-lib";
import * as batch from "aws-cdk-lib/aws-batch";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

export interface ClipperStackProps extends StackProps {
  /** Dashboard Worker base URL, e.g. https://clipper-dashboard.<sub>.workers.dev */
  apiUrl: string;
  r2Bucket: string;
}

/** Keys the job reads from the `clipper/runtime` secret (JSON). Fill them in after deploy. */
const RUNTIME_SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "CLIPPER_API_TOKEN",
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET",
] as const;

export class ClipperStack extends Stack {
  constructor(scope: Construct, id: string, props: ClipperStackProps) {
    super(scope, id, props);

    // ── Network: public subnets only (no NAT Gateway cost); S3 traffic stays on the gateway endpoint.
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 3,
      natGateways: 0,
      subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 22 }],
      gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } },
    });

    // ── Storage: sources + resumable work dirs (published clips live in Cloudflare R2).
    const work = new s3.Bucket(this, "WorkBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        { prefix: "work/", expiration: Duration.days(30) },
        { prefix: "sources/", expiration: Duration.days(90) },
        { prefix: "build/", expiration: Duration.days(7) },
        { abortIncompleteMultipartUploadAfter: Duration.days(2) },
      ],
    });

    // ── Image: built in CodeBuild (the ~10 GB image never crosses the home connection).
    const repo = new ecr.Repository(this, "Repo", {
      repositoryName: "clipper",
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 5 }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const build = new codebuild.Project(this, "ImageBuild", {
      projectName: "clipper-image",
      source: codebuild.Source.s3({ bucket: work, path: "build/source.zip" }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.LARGE, // 8 vCPU / 15 GB / 128 GB disk, ~$0.02/min
        privileged: true,
      },
      timeout: Duration.hours(2),
      environmentVariables: { REPO_URI: { value: repo.repositoryUri } },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              "aws ecr get-login-password | docker login --username AWS --password-stdin ${REPO_URI%%/*}",
              "TAG=$(date -u +%Y%m%d%H%M%S)",
            ],
          },
          build: {
            commands: [
              "docker pull $REPO_URI:latest || true",
              "docker build --cache-from $REPO_URI:latest -t $REPO_URI:latest -t $REPO_URI:$TAG .",
            ],
          },
          post_build: { commands: ["docker push $REPO_URI:$TAG", "docker push $REPO_URI:latest"] },
        },
      }),
      logging: { cloudWatch: { logGroup: new logs.LogGroup(this, "BuildLogs", { retention: logs.RetentionDays.ONE_MONTH }) } },
    });
    repo.grantPullPush(build);

    // ── Compute: GPU Spot instances that exist only while jobs run.
    const sg = new ec2.SecurityGroup(this, "BatchSg", { vpc, description: "Clipper batch (egress only)", allowAllOutbound: true });

    const launchTemplate = new ec2.LaunchTemplate(this, "GpuLaunchTemplate", {
      blockDevices: [{ deviceName: "/dev/xvda", volume: ec2.BlockDeviceVolume.ebs(200, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true }) }],
      requireImdsv2: true,
      httpPutResponseHopLimit: 2, // containers need IMDS hop for instance metadata
    });

    const computeEnv = new batch.ManagedEc2EcsComputeEnvironment(this, "GpuSpot", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [sg],
      spot: true,
      allocationStrategy: batch.AllocationStrategy.SPOT_PRICE_CAPACITY_OPTIMIZED,
      instanceTypes: [
        // g6 (L4) isn't offered in eu-west-1; add it here if you move regions.
        new ec2.InstanceType("g5.2xlarge"), // NVIDIA A10G, 8 vCPU, 32 GiB
        new ec2.InstanceType("g4dn.2xlarge"), // NVIDIA T4, 8 vCPU, 32 GiB (fallback)
      ],
      useOptimalInstanceClasses: false,
      images: [{ imageType: batch.EcsMachineImageType.ECS_AL2023_NVIDIA }],
      launchTemplate,
      minvCpus: 0,
      maxvCpus: 16, // up to 2 jobs in parallel; must fit the account's G/VT Spot vCPU quota
      updateToLatestImageVersion: true,
    });

    const queue = new batch.JobQueue(this, "Queue", {
      jobQueueName: "clipper-gpu",
      computeEnvironments: [{ computeEnvironment: computeEnv, order: 1 }],
    });

    const runtimeSecret = new secretsmanager.Secret(this, "RuntimeSecret", {
      secretName: "clipper/runtime",
      description: "Clipper job secrets (JSON). Fill every key after first deploy.",
      secretObjectValue: Object.fromEntries(
        RUNTIME_SECRET_KEYS.map((k) => [k, SecretValue.unsafePlainText("CHANGE_ME")]), // placeholders only
      ),
    });

    const jobRole = new iam.Role(this, "JobRole", { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com") });
    work.grantReadWrite(jobRole);

    const container = new batch.EcsEc2ContainerDefinition(this, "Container", {
      image: ecs.ContainerImage.fromEcrRepository(repo, "latest"),
      cpu: 7,
      memory: Size.gibibytes(28),
      gpu: 1,
      jobRole,
      command: ["--help"],
      environment: {
        CLIPPER_S3_BUCKET: work.bucketName,
        CLIPPER_API_URL: props.apiUrl,
        R2_BUCKET: props.r2Bucket,
        AWS_REGION: this.region,
        REMOTION_CONCURRENCY: "6",
      },
      secrets: Object.fromEntries(
        RUNTIME_SECRET_KEYS.map((k) => [k, batch.Secret.fromSecretsManager(runtimeSecret, k)]),
      ),
      linuxParameters: new batch.LinuxParameters(this, "LinuxParams", { sharedMemorySize: Size.gibibytes(4) }),
      volumes: [batch.EcsVolume.host({ name: "scratch", hostPath: "/scratch", containerPath: "/scratch" })],
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "clipper",
        logGroup: new logs.LogGroup(this, "JobLogs", { logGroupName: "/clipper/jobs", retention: logs.RetentionDays.ONE_MONTH }),
      }),
    });
    // Secrets resolve under CLIPPER_API_TOKEN; the CLI code reads CLIPPER_API_TOKEN, so names match.

    const jobDef = new batch.EcsJobDefinition(this, "JobDef", {
      jobDefinitionName: "clipper",
      container,
      timeout: Duration.hours(2),
      retryAttempts: 3,
      retryStrategies: [
        // Retry Spot reclaims / host failures; fail fast on application errors.
        batch.RetryStrategy.of(batch.Action.RETRY, batch.Reason.SPOT_INSTANCE_RECLAIMED),
        batch.RetryStrategy.of(batch.Action.RETRY, batch.Reason.CANNOT_PULL_CONTAINER),
        batch.RetryStrategy.of(batch.Action.EXIT, batch.Reason.custom({ onExitCode: "*" })),
      ],
    });

    // ── Policy for whoever runs `clipper submit` (attach to your IAM user/role or SSO permission set).
    const submitPolicy = new iam.ManagedPolicy(this, "SubmitPolicy", {
      managedPolicyName: "ClipperSubmit",
      statements: [
        new iam.PolicyStatement({
          actions: ["batch:SubmitJob"],
          resources: [queue.jobQueueArn, `arn:aws:batch:${this.region}:${this.account}:job-definition/clipper*`],
        }),
        new iam.PolicyStatement({ actions: ["batch:DescribeJobs", "batch:ListJobs"], resources: ["*"] }),
        new iam.PolicyStatement({ actions: ["s3:PutObject", "s3:AbortMultipartUpload"], resources: [work.arnForObjects("sources/*"), work.arnForObjects("build/*")] }),
        new iam.PolicyStatement({ actions: ["codebuild:StartBuild", "codebuild:BatchGetBuilds"], resources: [build.projectArn] }),
      ],
    });

    new CfnOutput(this, "WorkBucketName", { value: work.bucketName });
    new CfnOutput(this, "RepoUri", { value: repo.repositoryUri });
    new CfnOutput(this, "BuildProject", { value: build.projectName });
    new CfnOutput(this, "JobQueueName", { value: queue.jobQueueName });
    new CfnOutput(this, "JobDefinitionName", { value: "clipper" });
    new CfnOutput(this, "RuntimeSecretName", { value: runtimeSecret.secretName });
    new CfnOutput(this, "SubmitPolicyArn", { value: submitPolicy.managedPolicyArn });
    void jobDef;
  }
}
