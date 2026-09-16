FROM node:22-bookworm-slim

# FFmpeg + Python + pip нужны для обработки видео и yt-dlp
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Устанавливаем yt-dlp
RUN pip3 install --break-system-packages -U "yt-dlp[curl-cffi]"

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

CMD ["node", "dist/index.js"]