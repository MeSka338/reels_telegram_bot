import "dotenv/config";

import { Bot, InputFile, type Context } from "grammy";
import { rm } from "node:fs/promises";
import path from "node:path";

import { detectPlatform } from "./utils/detectPlatform.js";
import { isSupportedVideoUrl } from "./utils/validateUrl.js";
import {
  cleanupStaleTempDirs,
  downloadReel,
  DEFAULT_MAX_DURATION_SECONDS,
  DEFAULT_MAX_FILE_SIZE_BYTES,
} from "./services/downloadVideo.js";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN не указан в .env");

const bot = new Bot(token);
const MAX_QUEUE_SIZE = readPositiveInt("MAX_QUEUE_SIZE", 20);
const MAX_TASKS_PER_CHAT = readPositiveInt("MAX_TASKS_PER_CHAT", 1);
const MAX_DURATION_SECONDS = readPositiveInt("MAX_DURATION_SECONDS", DEFAULT_MAX_DURATION_SECONDS);
const MAX_FILE_SIZE_BYTES =
  readPositiveInt("MAX_FILE_SIZE_MB", Math.floor(DEFAULT_MAX_FILE_SIZE_BYTES / 1024 / 1024)) *
  1024 *
  1024;
type DownloadTask = { ctx: Context; url: string; chatId: number };
const queue: DownloadTask[] = [];
const pendingByChat = new Map<number, number>();
let isProcessing = false;

function helpText(): string {
  return (
    "ℹ️ Как пользоваться ботом\n\n" +
    "1. Отправьте одну ссылку на видео.\n" +
    "2. Дождитесь скачивания и обработки.\n" +
    "3. Бот отправит готовый MP4-файл.\n\n" +
    "Поддерживаются: Instagram Reels, YouTube и Shorts, TikTok, VK.\n" +
    `Ограничения: до ${Math.floor(MAX_DURATION_SECONDS / 60)} мин. и ${Math.floor(MAX_FILE_SIZE_BYTES / 1024 / 1024)} МБ.\n\n` +
    "Если видео не скачивается, проверьте, что ссылка публичная и ведёт именно на видео."
  );
}

function readPositiveInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function createProgressBar(percent: number): string {
  const progress = Math.min(100, Math.max(0, Math.floor(percent)));
  const filled = Math.round(progress / 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${progress}%`;
}

/** Serializes Telegram edits so stale progress cannot overwrite a newer phase. */
function createStatusController(ctx: Context, messageId: number) {
  let edits = Promise.resolve();
  let lastProgress = -1;
  let lastUpdateTime = 0;

  function set(text: string, force = false): void {
    const now = Date.now();
    if (!force && now - lastUpdateTime < 1_000) return;
    lastUpdateTime = now;
    edits = edits
      .then(async () => {
        await ctx.api.editMessageText(ctx.chat!.id, messageId, text);
      })
      .catch((error: unknown) => console.warn("Не удалось обновить статус:", error));
  }

  return {
    progress(title: string, percent: number) {
      const progress = Math.floor(percent);
      if (progress === lastProgress) return;
      lastProgress = progress;
      set(`${title}\n\n${createProgressBar(progress)}`);
    },
    status(text: string) {
      lastProgress = -1;
      set(text, true);
    },
    async flush() {
      await edits;
    },
  };
}

async function processQueue(): Promise<void> {
  if (isProcessing) return;
  const task = queue.shift();
  if (!task) return;
  isProcessing = true;

  let videoPath: string | null = null;
  try {
    const statusMessage = await task.ctx.reply("⏳ Подготавливаю видео...");
    const status = createStatusController(task.ctx, statusMessage.message_id);
    try {
      status.status("⬇️ Скачиваю видео...\n\n░░░░░░░░░░ 0%");
      videoPath = await downloadReel(task.url, {
        maxDurationSeconds: MAX_DURATION_SECONDS,
        maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
        onDownloadProgress: (percent) => status.progress("⬇️ Скачиваю видео...", percent),
        onProcessingProgress: (percent) => status.progress("⚙️ Обрабатываю видео...", percent),
      });

      let frame = 0;
      const uploadFrames = ["📤 Отправляю видео.", "📤 Отправляю видео..", "📤 Отправляю видео..."];
      status.status(uploadFrames[frame]);
      const animation = setInterval(() => {
        frame = (frame + 1) % uploadFrames.length;
        status.status(uploadFrames[frame]);
      }, 2_000);
      try {
        await task.ctx.replyWithVideo(new InputFile(videoPath), { supports_streaming: true });
      } finally {
        clearInterval(animation);
      }

      await status.flush();
      await task.ctx.api.deleteMessage(task.ctx.chat!.id, statusMessage.message_id).catch((error: unknown) => {
        console.warn("Не удалось удалить статус:", error);
      });
    } catch (error) {
      console.error("Не удалось обработать ссылку:", error);
      status.status("❌ Не удалось скачать видео. Проверьте ссылку, размер и длительность.");
      await status.flush();
    }
  } finally {
    if (videoPath) await rm(path.dirname(videoPath), { recursive: true, force: true });
    const left = (pendingByChat.get(task.chatId) ?? 1) - 1;
    if (left <= 0) pendingByChat.delete(task.chatId);
    else pendingByChat.set(task.chatId, left);
    isProcessing = false;
    void processQueue();
  }
}

bot.command("start", async (ctx) => {
  await ctx.reply("👋 Привет!\n\n" + helpText());
});

bot.command("help", async (ctx) => {
  await ctx.reply(helpText());
});

bot.on("message:text", async (ctx) => {
  const url = ctx.message.text.trim();
  const platform = detectPlatform(url);
  if (!platform || !isSupportedVideoUrl(url)) {
    await ctx.reply("❌ Нужна ссылка на Instagram Reel, YouTube, TikTok или VK-видео.");
    return;
  }

  const chatId = ctx.chat.id;
  if (queue.length >= MAX_QUEUE_SIZE) {
    await ctx.reply("⏳ Очередь заполнена. Попробуйте немного позже.");
    return;
  }
  if ((pendingByChat.get(chatId) ?? 0) >= MAX_TASKS_PER_CHAT) {
    await ctx.reply("⏳ В этом чате уже есть задача. Дождитесь её завершения.");
    return;
  }

  pendingByChat.set(chatId, (pendingByChat.get(chatId) ?? 0) + 1);
  queue.push({ ctx, url, chatId });
  const position = queue.length + (isProcessing ? 1 : 0);
  if (position > 1) await ctx.reply(`📥 Добавлено в очередь: позиция ${position}.`);
  console.log("Задача добавлена:", { platform, chatId, position });
  void processQueue();
});

bot.catch((error) => console.error("Необработанная ошибка Telegram:", error));

async function start(): Promise<void> {
  await cleanupStaleTempDirs();
  await bot.api.setMyCommands([
    { command: "start", description: "Начать работу с ботом" },
    { command: "help", description: "Показать инструкцию и ограничения" },
  ]);
  await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
  bot.start();
  console.log("🤖 Bot started");
}

void start().catch((error) => {
  console.error("Не удалось запустить бота:", error);
  process.exitCode = 1;
});
