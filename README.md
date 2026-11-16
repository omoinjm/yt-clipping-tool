# njmtech-clipping

Turns long-form videos into captioned 9:16 YouTube Shorts and uploads them as private drafts.

```
source ──ffmpeg──▶ source.mp4 + audio.wav
         WhisperX ─▶ transcript.json (word timestamps)
   PySceneDetect ─▶ scenes.json (shot cuts)
          Claude ─▶ ranked clip candidates (hook, title, description, tags)
  per clip: ffmpeg trim ▶ auto-editor (cut silences) ▶ WhisperX re-align
            ▶ face-tracked 9:16 reframe (OpenCV YuNet, blur fallback)
            ▶ Remotion render (animated word captions, hook card, progress bar)
         YouTube Data API ─▶ private upload
```

## Setup

```bash
uv sync                                  # Python deps (WhisperX pulls in torch, which is large)
(cd remotion && npm install)             # Remotion
cp .env.example .env                     # non-secret config; secrets come from Infisical
cp sources.example.yaml sources.yaml     # register your videos
```

Requires `ffmpeg` on PATH.

## Usage

```bash
uv run clipper run ep01                  # ingest → transcribe → scenes → select → produce
uv run clipper list ep01                 # see clips, scores, status
uv run clipper upload ep01               # private drafts to YouTube; publish from Studio
```

Each stage also runs on its own and is resumable: `ingest`, `transcribe [--diarize]`, `scenes`, `select [--n 8]`, `produce [--clip ep01-03] [--force]`, `upload`.

Outputs go to `work/<source>/clips/<clip>/final.mp4`.

Preview or tweak caption styling: `cd remotion && npm run studio` (drop an mp4 at `remotion/public/clips/sample.mp4`).

## Cloud mode (AWS GPU + Cloudflare dashboard)

```
clipper submit ep01 ──▶ S3 (source) ──▶ AWS Batch, GPU Spot (g5/g4dn .2xlarge, scales to 0)
                                         └─ clipper cloud-run ep01: WhisperX large-v3 on CUDA, NVENC,
                                            Remotion ×6 ─▶ clips to Cloudflare R2 ─▶ status to D1
dashboard (Cloudflare Worker + Access login) ◀── D1 + R2 ── review, edit, upload to YouTube
```

| Path | What |
|---|---|
| `infra/aws/` | CDK stack: VPC (no NAT), S3 work bucket, ECR, CodeBuild image build, Batch Spot GPU, Bedrock-enabled job role, `ClipperSubmit` IAM policy |
| `Dockerfile` | CUDA 12.8 + cuDNN, FFmpeg (NVENC), Node 24 + Remotion + Chrome, WhisperX models baked in |
| `scripts/build-image.sh` | zip → S3 → CodeBuild → ECR (the ~10 GB image is built in AWS) |
| `dashboard/` | Worker (Hono): D1 `clipper`, R2 `clipper-clips`, Access JWT check, `/api/internal/*` for CLI/jobs |

### Secrets: Infisical

All secrets live in the Infisical project **njmtech-clipping** (`.infisical.json`), in the `prod` and `dev` environments.
- **Locally:** prefix commands with `infisical run --`.
- **In Batch:** the container logs in as the machine identity **clipper-batch** using **AWS IAM auth**, trusting the role `clipper-batch-job`, so no Infisical credential is stored anywhere (`docker-entrypoint.sh`).
- **Dashboard Worker:** `scripts/sync-worker-secrets.sh` pushes its secrets from Infisical to Cloudflare.

| Key | Used by |
|---|---|
| `CLIPPER_API_TOKEN` | CLI + job → dashboard internal API (synced to the Worker as `INTERNAL_API_TOKEN`) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` | job → R2 clip uploads |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | CLI + job → through Cloudflare Access |
| `HF_TOKEN` | `--diarize` (pyannote) |
| `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` | dashboard "Upload to YouTube" (from `clipper youtube-auth`) |

Claude runs on **Amazon Bedrock** (`eu.anthropic.claude-sonnet-4-6`; Opus 5.5 once AWS enables it for the account) with IAM credentials, so no API key is needed. The account must first submit Anthropic's use-case form once: Bedrock console → Model catalog → any Claude model.

### One-time setup

1. **Cloudflare** (`dashboard/`):
   - D1 `clipper` and R2 `clipper-clips` already exist.
   - Run `npm run db:migrate` after schema changes and `npx wrangler deploy` to ship.
   - `./scripts/sync-worker-secrets.sh` after changing Worker secrets in Infisical.
   - Zero Trust → Access → Applications: a self-hosted app on the Worker hostname.
     - Policy *Allow*: your email (One-time PIN).
     - Policy *Service Auth*: service token `clipper-batch`, saved to Infisical as `CF_ACCESS_CLIENT_*`.
     - Put the team domain and AUD in `wrangler.jsonc` `vars`, then redeploy.
2. **Infisical**: identity `clipper-batch` (`<INFISICAL_IDENTITY_ID>`) already exists. To recreate it: Organization → Access Control → Identities → create `clipper-batch`.
   - Auth method **AWS Auth**: allowed account `<AWS_ACCOUNT_ID>`, principal ARN `arn:aws:sts::<AWS_ACCOUNT_ID>:assumed-role/clipper-batch-job/*`.
   - Add it to project `njmtech-clipping` with the **Viewer** role.
3. **AWS** (`infra/aws/`): `npx cdk deploy -c infisicalIdentityId=<identity id>`, then `./scripts/build-image.sh`.
   - The G/VT Spot quota must be ≥ 8 vCPU (16 requested).

### Daily use

```bash
infisical run -- uv run clipper submit ep01   # uploads source, queues GPU job
infisical run -- uv run clipper jobs          # status (or watch the dashboard)
```

Cost: you pay only while a job runs. A Spot g6.2xlarge costs about $0.3–0.5/h, and a 1-hour source takes roughly 10–15 min. R2 storage is about $0.015/GB-month, with free egress.

### Cost guard and teardown

There's no hard cap in AWS, so the stack enforces one.

**Budget `clipper-monthly`:** $20/month of **real card spend** (credits are netted out).
- Emails at 80%, at 100%, and when the forecast passes 100%.

**Kill switch (Lambda `clipper-cost-guard`):** runs at 100% of actual spend, and daily at 06:00 UTC if Free-plan credits drop below $5.
- Disables the GPU queue and compute environment, cancels all jobs, and emails `clipper-cost-guard`.
- Confirm that SNS email subscription once.

**Scripts:**
- `./scripts/resume.sh` turns processing back on after the kill switch fires.
- `./scripts/teardown.sh [--cloudflare]` deletes every AWS resource (stack, retained bucket/ECR/logs, budget, CDK bootstrap), plus optionally the Worker/D1/R2. Closing the AWS account is a console step (root → Account → Close account), printed at the end.

## Rights and monetization

- `ingest` refuses any source that isn't `permission: own` or `granted`. `granted` also needs `proof` and `credit`, and the credit is added to the description.
- Only clip content you own or have written permission for. Re-uploading other people's videos risks copyright strikes and fails YouTube's "reused content" monetization policy. Captions, hooks and tight edits help, but they don't replace permission.
- YouTube Partner Program for Shorts: 1,000 subscribers + 10M Shorts views in 90 days.

## YouTube API notes

- Create a Google Cloud project, enable **YouTube Data API v3**, create an OAuth client of type **Desktop app**, and save it as `client_secret.json`. The first upload prints an auth URL.
- Default quota is 10,000 units/day. One upload costs about 1,600, so about 6 uploads/day.
- Until Google audits the API project, uploads are locked to private. That's fine for drafts, but apply for the audit early.

## Hardware

WhisperX on CPU: use `WHISPER_MODEL=small` (int8) on machines with about 8 GB RAM. With an NVIDIA GPU (CUDA), use `large-v3` for the best accuracy.

## Licenses

Remotion is free for individuals and companies of up to 3 people. Larger teams need a company license (remotion.pro). auto-editor is Unlicense. WhisperX is BSD-2. PySceneDetect is BSD-3. FFmpeg is LGPL/GPL.
