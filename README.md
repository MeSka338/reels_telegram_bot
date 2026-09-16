# Video downloader bot

Telegram bot that downloads supported Instagram Reels, YouTube, TikTok, and VK videos and sends them back as MP4.

## Configuration

Create `.env` with `BOT_TOKEN`. Optional limits are `MAX_QUEUE_SIZE` (default `20`), `MAX_TASKS_PER_CHAT` (default `1`), `MAX_DURATION_SECONDS` (default `600`), and `MAX_FILE_SIZE_MB` (default `45`).

The host needs `yt-dlp`, `ffmpeg`, and `ffprobe`; the Docker image includes them.
The image pins yt-dlp to `2026.08.19`; update the `YT_DLP_VERSION` build argument deliberately when a provider changes its download flow.

## Deployment

The GitHub workflow publishes both `latest` and an immutable image tag equal to the commit SHA, then deploys that SHA. Configure `VPS_SSH_KEY`, `VPS_HOST`, and `VPS_USER`. Optionally configure `VPS_KNOWN_HOSTS` with the pre-verified host key line for the VPS; when it is absent, the workflow keeps backward compatibility by fetching the key during deployment.
