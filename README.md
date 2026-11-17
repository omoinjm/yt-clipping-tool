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

All secrets and account-specific IDs live in the Infisical project **njmtech-clipping**, in the `prod` and `dev` environments. Run `infisical init` once to link your checkout; `.infisical.json` is git-ignored. Nothing account-specific is tracked in git:
- AWS account ID, alert email, Cloudflare account ID, D1 ID, Access domain and AUD, Infisical IDs and the dashboard URL are all in Infisical
- `infra/aws` reads them from the environment
- `dashboard/wrangler.jsonc` is rendered from a template
- **Locally:** prefix commands with `infisical run --`.
- **In Batch:** the container logs in as the machine identity **clipper-batch** using **AWS IAM auth**, trusting the role `clipper-batch-job`, so no Infisical credential is stored anywhere (`docker-entrypoint.sh`).
- **Dashboard Worker:** `scripts/sync-worker-secrets.sh` pushes its secrets from Infisical to Cloudflare.

| Key | Used by |
|---|---|
| `CLIPPER_API_TOKEN` | CLI + job → dashboard internal API (synced to the Worker as `INTERNAL_API_TOKEN`) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` | job → R2 clip uploads |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | CLI + job → through Cloudflare Access |
| `HF_TOKEN` | `--diarize` (pyannote) |
| `YT_CLIENT_ID`, `YT_CLIENT_SECRET` | dashboard **Accounts → Connect YouTube** (Google OAuth *Web application* client) |
| `TOKEN_ENC_KEY` | encrypts TikTok/Instagram tokens stored in D1 (`openssl rand -base64 32`) |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | dashboard "Post to TikTok" |
| `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID` | dashboard "Post to Instagram" (Unified login; also needs the `R2_*` keys, synced to the Worker) |

Claude runs on **Amazon Bedrock** (`eu.anthropic.claude-sonnet-4-6`; Opus 5.5 once AWS enables it for the account) with IAM credentials, so no API key is needed. The account must first submit Anthropic's use-case form once: Bedrock console → Model catalog → any Claude model.

### One-time setup

1. **Cloudflare** (`dashboard/`): config is rendered from `wrangler.template.jsonc` with IDs from Infisical.
   - `./scripts/dashboard.sh deploy` ships the Worker. `./scripts/dashboard.sh migrate` applies D1 migrations, and `./scripts/dashboard.sh dev` runs it locally.
   - `./scripts/sync-worker-secrets.sh` after changing Worker secrets in Infisical.
   - Zero Trust → Access → Applications: a self-hosted app on the Worker hostname.
     - Policy *Allow*: your email (One-time PIN).
     - Policy *Service Auth*: service token `clipper-batch`, saved to Infisical as `CF_ACCESS_CLIENT_*`.
     - Save the team domain and the app's AUD in Infisical as `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`, then run `scripts/sync-worker-secrets.sh`.
2. **Infisical**: Organization → Access Control → Identities → create `clipper-batch` (store its ID in Infisical as `INFISICAL_IDENTITY_ID`).
   - Auth method **AWS Auth**: allowed account `<AWS_ACCOUNT_ID>`, principal ARN `arn:aws:sts::<AWS_ACCOUNT_ID>:assumed-role/clipper-batch-job`.
   - Add it to project `njmtech-clipping` with the **Viewer** role.
3. **AWS** (`infra/aws/`): `infisical run --env prod -- npx cdk deploy`, then `./scripts/build-image.sh`.
   - The G/VT Spot quota must be ≥ 8 vCPU (16 requested).

### Deploying the dashboard

Pushes to `main` deploy the Worker through Cloudflare Workers Builds (Workers & Pages → `clipper-dashboard` → Settings → Build):

| Setting | Value |
|---|---|
| Root directory | `dashboard` |
| Build command | `python3 ../scripts/render-wrangler.py` |
| Deploy command | `npx wrangler deploy` |
| Build variables | `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` (same values as Infisical) |
| Build watch paths | `dashboard/*`, `scripts/render-wrangler.py` |

- The two IDs must be **build** variables (the Variables and secrets section under Build), not Worker runtime variables. `render-wrangler.py` fills `wrangler.template.jsonc` from them.
- The build deploys code only. Still run by hand:
  - `./scripts/dashboard.sh migrate` for new D1 migrations, before pushing code that needs them.
  - `./scripts/sync-worker-secrets.sh` after changing Worker secrets in Infisical.
- `./scripts/dashboard.sh deploy` still works for a manual deploy.

### Daily use

**Dashboard (recommended):** open the dashboard → **+ New source**.
1. Paste a video URL, or upload a file. Uploads go to R2 in 32 MB chunks; any size works, and they're deleted after 30 days.
2. Pick the rights:

   | Option | When | Needs |
   |---|---|---|
   | **I own it** | your own video | — |
   | **Creative Commons (CC BY)** | the video's license is CC Attribution | URL + credit line. The job **verifies the license** and rejects NC/ND variants and Standard YouTube License videos. |
   | **Permission granted** | a creator allowed you in writing | proof link + credit line |

3. **Start clipping** queues the GPU job (via the `clipper-dashboard` IAM user, which can only `batch:SubmitJob`). Clips appear under **Clips → To review**.

**CLI (alternative):** register the source in `sources.yaml`, then:

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

## Dashboard users

**Users** in the dashboard adds and removes the people who can sign in. All users have full access.
- Sign-in is Cloudflare Access: users get a one-time code by email, or use your identity provider.
- Users are the email rules of one Access group, edited through the Cloudflare API.
- Removing someone also revokes their current Access session.

One-time setup:
1. **Zero Trust → Access → Rules → Groups:** add the group **Clipper users**, include **Emails** (yours), and save. Copy the group ID from the URL.
2. **Access → Applications →** the dashboard app **→ Policies:** make the Allow policy include **Access group: Clipper users**. Remove individual email rules, or removing a user won't lock them out.
3. **My Profile → API Tokens → Create custom token:** Account → **Access: Organizations, Identity Providers, and Groups → Edit**, for this account.
4. Put `CF_API_TOKEN` and `CF_ACCESS_GROUP_ID` in Infisical (prod), then run `./scripts/sync-worker-secrets.sh`. `CF_ACCOUNT_ID` is synced from `CLOUDFLARE_ACCOUNT_ID`.

## Public upload link

**Submissions** in the dashboard creates a secret link (`/u/<token>`) that anyone can use to upload a video. Uploaders can only upload; they can't see clips or accounts or post anywhere.

- Each upload needs the uploader's name, email and a rights confirmation, and passes a Turnstile bot check.
- Uploads are limited to video files up to 5 GB and 5 per hour per network. They go to R2 under `submissions/`.
- **Nothing is processed until you review it.** **Accept** creates a "permission granted" source, using the uploader's details as proof and their credit line, then queues the GPU job. **Reject** deletes the file.
- **New link** rotates the token, so the old link stops working. **Turn off** disables uploads.
- Abandoned uploads are cleaned up by the hourly cron.

One-time setup:
1. **Cloudflare Access:** the dashboard sits behind Access, so add a second Access application for the same hostname with **path `u`** and a **Bypass → Everyone** policy. Only `/u/*` becomes public; everything else still needs login. The Worker never serves dashboard data on `/u`.
2. **Turnstile:** Cloudflare dashboard → Turnstile → Add widget.
   - Hostname: the dashboard's. Mode: Managed.
   - Put its keys in Infisical as `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`, then run `./scripts/sync-worker-secrets.sh`.
   - Without them the page still works, but with no bot check; the Submissions page warns about it.
3. Optional: an R2 lifecycle rule to expire `submissions/` objects after N days. Accepted sources still need theirs until the job has run.



Each clip page has **TikTok** and **Instagram** sections next to YouTube.

- **Captions** start out automatic: the clip's title, description (Instagram only), up to 5 hashtags from its tags, and the credit line. Edit the text and **Save caption** to keep your own; **Use auto caption** goes back. For CC BY and "permission granted" sources, the credit line is added back if it's edited out.
- **TikTok**: **Post now** (caption, who can view, comments/duet/stitch) or **Send to TikTok drafts** (finish in the app; drafts carry no caption, so paste it there).
- **Instagram**: posts a Reel; "Also show in the profile grid" is `share_to_feed`.
- Posts process asynchronously. A cron runs every minute to finish them and records the result with a link. It also refreshes the Instagram token before its 60 days run out.

**Connect accounts** under **Accounts** in the dashboard (OAuth; tokens are stored encrypted in D1). One-time app setup:

1. **TikTok** ([developers.tiktok.com](https://developers.tiktok.com/)): create an app.
   - Add **Login Kit** and **Content Posting API** (enable Direct Post).
   - Scopes `user.info.basic`, `video.publish`, `video.upload`.
   - Redirect URI `https://<dashboard>/oauth/tiktok/callback`.
   - Put the client key/secret in Infisical as `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.
   - **Until TikTok audits the app, direct posts are private ("Only me") and the posting account must be private.** Drafts work for any account. Apply for the audit from the app page once it works.
2. **Instagram** ([developers.facebook.com](https://developers.facebook.com/apps)) uses the **Instagram API with Unified Login**, Meta's setup for new apps.
   - Create a **business portfolio** (business.facebook.com) and add the Instagram account to it. The account must be a **Business or Creator** account.
   - Create an app with the use case **Manage messaging & content on Instagram**, owned by that portfolio.
   - **App settings → Basic:** privacy policy `https://njmtech.co.za/clippers-policy`, terms `https://njmtech.co.za/clippers-terms`.
   - **Use cases → Customize → API setup with Unified login → Create new configuration:**
     - Pick a token that **never expires**, and keep `instagram_basic` and `instagram_content_publish`.
     - Redirect URL `https://<dashboard>/oauth/instagram/callback`.
   - Put the *Meta* app ID/secret (App settings → Basic) and the configuration ID in Infisical as `META_APP_ID`, `META_APP_SECRET` and `META_CONFIG_ID`.
   - On connect, select the Instagram account to share. Instagram downloads each video from a presigned R2 link that expires after 2 hours, so the dashboard stays behind Access.
3. Add `TOKEN_ENC_KEY` to Infisical, then run `./scripts/dashboard.sh migrate` and `./scripts/sync-worker-secrets.sh`.

## YouTube API notes

- **Dashboard:** connect the channel under **Accounts → Connect YouTube**. One-time Google Cloud setup:
  1. Create a project and enable **YouTube Data API v3**.
  2. **Google Auth Platform → Branding/Audience:** External. Set it to **In production**: in "Testing" mode, Google expires the refresh token after 7 days. Unverified is fine for your own channels; Google shows an "unverified app" warning you click through.
  3. **Data access:** add the scopes `youtube.upload` and `youtube.readonly`.
  4. **Clients → Create client → Web application**, redirect URI `https://<dashboard>/oauth/youtube/callback`. Put its ID/secret in Infisical as `YT_CLIENT_ID` / `YT_CLIENT_SECRET`, then run `./scripts/sync-worker-secrets.sh`.
  5. Sign in with the Google account that owns or manages the channel. For a brand channel, **pick the channel on the account chooser**; the Accounts page then shows its handle so you can confirm it's the right one.
- **Local CLI** (`clipper upload`): uses a separate **Desktop app** client saved as `client_secret.json`; the first upload prints an auth URL.
- Default quota is 10,000 units/day. One upload costs about 1,600, so about 6 uploads/day.
- Until Google audits the API project, uploads are locked to private. That's fine for drafts, but apply for the audit early.

## Hardware

WhisperX on CPU: use `WHISPER_MODEL=small` (int8) on machines with about 8 GB RAM. With an NVIDIA GPU (CUDA), use `large-v3` for the best accuracy.

## Licenses

Remotion is free for individuals and companies of up to 3 people. Larger teams need a company license (remotion.pro). auto-editor is Unlicense. WhisperX is BSD-2. PySceneDetect is BSD-3. FFmpeg is LGPL/GPL.
