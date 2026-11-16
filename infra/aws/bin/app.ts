import { App } from "aws-cdk-lib";
import { ClipperStack } from "../lib/clipper-stack.js";

/**
 * Account-specific values come from Infisical (njmtech-clipping), never from tracked files:
 *   infisical run --env prod -- npx cdk deploy
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run via \`infisical run --env prod -- npx cdk ...\``);
  return value;
}

const app = new App();
new ClipperStack(app, "Clipper", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "eu-west-1" },
  apiUrl: required("CLIPPER_API_URL"),
  r2Bucket: app.node.tryGetContext("r2Bucket") ?? "clipper-clips",
  alertEmail: required("ALERT_EMAIL"),
  infisicalIdentityId: required("INFISICAL_IDENTITY_ID"),
  infisicalProjectId: required("INFISICAL_PROJECT_ID"),
});
