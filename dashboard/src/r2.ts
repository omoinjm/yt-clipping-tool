import { AwsClient } from "aws4fetch";

/**
 * Presigned link to an R2 object via its S3 API, for things outside Cloudflare that need one object
 * for a short time: Instagram downloading a Reel, the CPU render job reading inputs / writing outputs.
 */
export async function presign(env: Env, key: string, method: "GET" | "PUT" = "GET", seconds = 7200): Promise<string> {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY)
    throw new Error("R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not set on the Worker");
  const r2 = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
  const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key.split("/").map(encodeURIComponent).join("/")}`);
  url.searchParams.set("X-Amz-Expires", String(seconds));
  return (await r2.sign(url.toString(), { method, aws: { signQuery: true } })).url;
}
