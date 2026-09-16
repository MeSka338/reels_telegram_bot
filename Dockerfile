FROM node:22-bookworm-slim

# FFmpeg + Python + pip нужны для обработки видео и yt-dlp
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Устанавливаем yt-dlp
ARG YT_DLP_VERSION=2026.08.19
RUN pip3 install --no-cache-dir --break-system-packages "yt-dlp[curl-cffi]==${YT_DLP_VERSION}"

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

# The compiled application does not need the TypeScript toolchain at runtime.
RUN npm prune --omit=dev

CMD ["node", "dist/index.js"]
