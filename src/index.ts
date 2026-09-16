import "dotenv/config";

import { Bot, InputFile, type Context } from "grammy";
import { rm } from "node:fs/promises";
import path from "node:path";

import { detectPlatform } from "./utils/detectPlatform.js";
import { downloadReel } from "./services/downloadVideo.js";

const token = process.env.BOT_TOKEN;

if (!token) {
  throw new Error("BOT_TOKEN не указан в .env");
}

const bot = new Bot(token);

type DownloadTask = {
  ctx: Context;
  url: string;
};

const queue: DownloadTask[] = [];
let isProcessing = false;

// -------------------------
// Обработка очереди
// -------------------------

async function processQueue() {
  if (isProcessing) {
    return;
  }

  const task = queue.shift();

  if (!task) {
    return;
  }

  isProcessing = true;

  const { ctx, url } = task;

  let videoPath: string | null = null;

  try {
    const statusMessage = await ctx.reply("⏳ Скачиваю видео...");

    try {
      videoPath = await downloadReel(url);

      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        "📤 Отправляю видео...",
      );

      await ctx.replyWithVideo(new InputFile(videoPath), {
        supports_streaming: true,
      });

      await ctx.api.deleteMessage(ctx.chat!.id, statusMessage.message_id);
    } catch (error) {
      console.error(error);

      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        "❌ Не удалось скачать видео.",
      );
    }
  } finally {
    if (videoPath) {
      const tempDir = path.dirname(videoPath);

      await rm(tempDir, {
        recursive: true,
        force: true,
      });

      console.log("🗑️ Временные файлы удалены:", tempDir);
    }

    isProcessing = false;

    // Запускаем следующую задачу
    void processQueue();
  }
}

// -------------------------
// /start
// -------------------------

bot.command("start", async (ctx) => {
  await ctx.reply(
    "👋 Привет!\n\n" +
      "Отправь мне ссылку на видео.\n\n" +
      "Поддерживаются:\n" +
      "• Instagram Reels\n" +
      "• YouTube\n" +
      "• YouTube Shorts\n" +
      "• TikTok\n" +
      "• VK",
  );
});

// -------------------------
// Видео
// -------------------------

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();

  const platform = detectPlatform(text);

  if (!platform) {
    await ctx.reply(
      "❌ Не удалось распознать ссылку.\n\n" +
        "Поддерживаются:\n" +
        "• Instagram Reels\n" +
        "• YouTube\n" +
        "• YouTube Shorts\n" +
        "• TikTok\n" +
        "• VK",
    );

    return;
  }

  console.log("Platform:", platform);

  // ВАЖНО:
  // downloadReel здесь больше НЕ await'им.
  // Только кладём задачу в очередь.
  queue.push({
    ctx,
    url: text,
  });

  // Запускаем очередь отдельно.
  void processQueue();

  // Handler заканчивается практически сразу.
  // Telegram сможет подтвердить update.
});

// -------------------------
// Запуск
// -------------------------

bot.start();

console.log("🤖 Bot started");
