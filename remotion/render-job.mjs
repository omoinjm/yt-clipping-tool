// CPU re-render job (AWS Batch on Fargate, image Dockerfile.render). Holds no secrets: everything comes
// from SPEC_URL, a short-lived presigned R2 link to a JSON spec written by the dashboard:
//   { clipId, hook, header,
//     inputs:  { video: <GET vertical.mp4>, props: <GET props.json> },
//     outputs: { video: <PUT final.mp4>, thumb: <PUT final.jpg> } }
// It renders the clip again with the new header (same reframed video and word timings), then uploads.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function get(url, what) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${what}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function put(url, body, type, what) {
  const res = await fetch(url, { method: "PUT", body, headers: { "Content-Type": type } });
  if (!res.ok) throw new Error(`upload ${what}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  const specUrl = process.env.SPEC_URL;
  if (!specUrl) throw new Error("SPEC_URL is not set");
  const spec = JSON.parse((await get(specUrl, "spec")).toString());
  const id = String(spec.clipId).replace(/[^\w.-]/g, "_");
  log("re-rendering", id);

  const clipPath = join(here, "public", "clips", `${id}.mp4`);
  mkdirSync(dirname(clipPath), { recursive: true });
  writeFileSync(clipPath, await get(spec.inputs.video, "vertical video"));
  const props = JSON.parse((await get(spec.inputs.props, "props")).toString());
  Object.assign(props, { src: `clips/${id}.mp4`, hook: spec.hook ?? props.hook, header: spec.header });
  const propsPath = "/tmp/props.json";
  writeFileSync(propsPath, JSON.stringify(props));

  const out = "/tmp/final.mp4";
  const args = ["remotion", "render", "src/index.ts", "ShortClip", out, `--props=${propsPath}`, "--codec=h264", "--crf=18",
    `--concurrency=${process.env.REMOTION_CONCURRENCY || 4}`, "--log=error"];
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync("npx", args, { cwd: here, stdio: "inherit" });
      break;
    } catch (e) {
      if (attempt >= 2) throw new Error(`remotion render failed twice: ${e.message}`);
      log("render failed (fonts can time out), retrying once");
    }
  }
  const at = Math.min(1, (props.durationSec || 2) / 2).toFixed(2);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", at, "-i", out, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "3", "/tmp/final.jpg"]);

  await put(spec.outputs.video, readFileSync(out), "video/mp4", "video");
  await put(spec.outputs.thumb, readFileSync("/tmp/final.jpg"), "image/jpeg", "thumbnail");
  log("done");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
