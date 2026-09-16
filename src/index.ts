import "dotenv/config";
import { isInstagramReelUrl } from "./validateUrl.js";
import { downloadReel } from "./downloadReel.js";
import { Bot, InputFile } from "grammy";
import { rm } from "node:fs/promises";
import path from "node:path";

const token = process.env.BOT_TOKEN;

if (!token) {
  throw new Error("BOT_TOKEN не указан в .env");
}

const bot = new Bot(token);

bot.command("start", async (ctx) => {
  await ctx.reply("Привет! Отправь мне ссылку на Instagram Reel.");
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();

  if (!isInstagramReelUrl(text)) {
    await ctx.reply("❌ Отправь корректную ссылку на Instagram Reel.");
    return;
  }

  const statusMessage = await ctx.reply("⏳ Скачиваю Reel...");

  let videoPath: string | null = null;

  try {
    videoPath = await downloadReel(text);

    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      "📤 Отправляю видео...",
    );

    await ctx.replyWithVideo(new InputFile(videoPath), {
      supports_streaming: true,
    });

    await ctx.api.deleteMessage(ctx.chat.id, statusMessage.message_id);
  } catch (error) {
    console.error(error);

    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      "❌ Не удалось скачать Reel.",
    );
  } finally {
    if (videoPath) {
      const tempDir = path.dirname(videoPath);

      await rm(tempDir, {
        recursive: true,
        force: true,
      });

      console.log("🗑️ Временные файлы удалены:", tempDir);
    }
  }
});

bot.start();

console.log("🤖 Bot started");
