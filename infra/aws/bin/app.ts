import { App } from "aws-cdk-lib";
import { ClipperStack } from "../lib/clipper-stack.js";

const app = new App();
new ClipperStack(app, "Clipper", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "eu-west-1" },
  apiUrl: app.node.tryGetContext("apiUrl") ?? "",
  r2Bucket: app.node.tryGetContext("r2Bucket") ?? "clipper-clips",
  infisicalIdentityId: app.node.tryGetContext("infisicalIdentityId") ?? "",
  infisicalProjectId: app.node.tryGetContext("infisicalProjectId") ?? "",
});
