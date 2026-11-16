# Clipper GPU worker for AWS Batch: WhisperX (CUDA) + FFmpeg (NVENC) + auto-editor + Remotion.
FROM nvcr.io/nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ARG NODE_VERSION=24.20.0
ENV DEBIAN_FRONTEND=noninteractive \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility,video \
    UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never \
    HF_HOME=/opt/cache/hf TORCH_HOME=/opt/cache/torch \
    PATH=/app/.venv/bin:/opt/node/bin:$PATH

# FFmpeg (Ubuntu's build has NVENC; the driver lib is mounted by the NVIDIA runtime),
# Python 3.12, and the shared libs Chrome Headless Shell needs for Remotion.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3.12 python3.12-venv ca-certificates curl xz-utils \
      libnss3 libdbus-1-3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libgbm1 libasound2t64 \
      libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 \
      fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz \
       | tar -xJ -C /opt && mv /opt/node-v${NODE_VERSION}-linux-x64 /opt/node

COPY --from=ghcr.io/astral-sh/uv:0.9.21 /uv /usr/local/bin/uv
WORKDIR /app

# Python deps first (cached layer).
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project --python python3.12

# Remotion deps + Chrome Headless Shell.
COPY remotion/package.json remotion/package-lock.json remotion/
RUN cd remotion && npm ci --no-audit --no-fund && npx remotion browser ensure

# Bake models so jobs never download them.
RUN python -c "import whisperx; whisperx.load_model('large-v3', 'cpu', compute_type='int8'); whisperx.load_align_model(language_code='en', device='cpu')" \
    && mkdir -p /app/models \
    && curl -fsSL -o /app/models/face_detection_yunet_2023mar.onnx \
       https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx

COPY remotion/ remotion/
COPY src/ src/
COPY README.md ./
RUN uv sync --frozen --no-dev --python python3.12 && auto-editor --version

ENV WHISPER_MODEL=large-v3 WHISPER_BATCH_SIZE=16 WHISPER_DEVICE=auto \
    CLIPPER_STATE=api CLIPPER_WORK_DIR=/scratch/work
ENTRYPOINT ["clipper"]
CMD ["--help"]
