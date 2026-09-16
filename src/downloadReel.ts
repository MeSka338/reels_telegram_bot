import { execFile } from "node:child_process";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function exec(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        console.error(stderr);
        reject(error);
        return;
      }

      console.log(stdout);
      resolve();
    });
  });
}

export async function downloadReel(url: string): Promise<string> {
  const id = randomUUID();

  const tempDir = path.resolve("temp", id);

  await mkdir(tempDir, { recursive: true });

  const originalFile = path.join(tempDir, "original.mp4");
  const outputFile = path.join(tempDir, "video.mp4");

  try {
    // 1. Скачиваем оригинал
    console.log("Скачиваю Reel...");

    await exec("yt-dlp", [
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

    return outputFile;
  } catch (error) {
    console.error("Ошибка обработки Reel:", error);

    throw new Error("Не удалось скачать или обработать Reel");
  }
}
