import { execFile, type ChildProcess } from "node:child_process";
import { mkdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

let activeProcess: ChildProcess | null = null;
let activeTempDir: string | null = null;

function exec(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, (error, stdout, stderr) => {
      activeProcess = null;

      if (error) {
        console.error(stderr);
        reject(error);
        return;
      }

      console.log(stdout);
      resolve();
    });

    activeProcess = child;
  });
}

async function cleanup() {
  // Останавливаем yt-dlp или ffmpeg
  if (activeProcess) {
    console.log("🛑 Останавливаю активный процесс...");

    activeProcess.kill("SIGTERM");
    activeProcess = null;
  }

  // Удаляем недокачанные/временные файлы
  if (activeTempDir) {
    console.log("🗑️ Удаляю временные файлы...");

    await rm(activeTempDir, {
      recursive: true,
      force: true,
    });

    activeTempDir = null;
  }
}

async function shutdown() {
  console.log("\n🛑 Завершение работы...");

  try {
    await cleanup();
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

export async function downloadReel(url: string): Promise<string> {
  const id = randomUUID();

  const tempDir = path.resolve("temp", id);

  activeTempDir = tempDir;

  await mkdir(tempDir, { recursive: true });

  const originalFile = path.join(tempDir, "original.mp4");
  const outputFile = path.join(tempDir, "video.mp4");

  try {
    // 1. Скачиваем оригинал
    console.log("Скачиваю Reel...");

    await exec("yt-dlp", [
      "--impersonate",
      "Chrome-133:Macos-15",
      "-f",
      "bv*+ba/b",
      "--merge-output-format",
      "mp4",
      "--no-playlist",
      "-o",
      originalFile,
      url,
    ]);

    console.log("Reel скачан. Сжимаю...");

    // 2. Конвертируем в H.264 + AAC
    await exec("ffmpeg", [
      "-y",

      "-i",
      originalFile,

      "-c:v",
      "libx264",

      "-crf",
      "30",

      "-preset",
      "medium",

      "-c:a",
      "aac",

      "-b:a",
      "96k",

      "-movflags",
      "+faststart",

      outputFile,
    ]);

    console.log("Видео готово:", outputFile);

    // 3. Удаляем тяжелый оригинал
    await unlink(originalFile);

    // outputFile ещё нужен index.ts для отправки в Telegram,
    // поэтому tempDir здесь НЕ удаляем.
    activeTempDir = null;

    return outputFile;
  } catch (error) {
    console.error("Ошибка обработки Reel:", error);

    // Если yt-dlp / ffmpeg упал — удаляем весь мусор
    await rm(tempDir, {
      recursive: true,
      force: true,
    });

    activeTempDir = null;

    throw new Error("Не удалось скачать или обработать Reel");
  }
}
