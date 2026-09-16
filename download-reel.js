const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const url = process.argv[2];

if (!url) {
  console.error("Укажи ссылку на Instagram Reel");
  process.exit(1);
}

const tempFile = path.join(__dirname, "temp-reel.mp4");
const outputFile = path.join(__dirname, `reel-${Date.now()}.mp4`);

// 1. Скачиваем Reel
execFile(
  "yt-dlp",
  ["-f", "bv*+ba/b", "--merge-output-format", "mp4", "-o", tempFile, url],
  (error) => {
    if (error) {
      console.error("Ошибка скачивания:", error.message);
      return;
    }

    console.log("Видео скачано. Сжимаю...");

    // 2. Сжимаем через FFmpeg
    execFile(
      "ffmpeg",
      [
        "-i",
        tempFile,

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
      ],
      (error) => {
        if (error) {
          console.error("Ошибка сжатия:", error.message);
          return;
        }

        // удаляем оригинальный большой файл
        fs.unlinkSync(tempFile);

        console.log("Готово!");
        console.log(`Файл: ${outputFile}`);
      },
    );
  },
);
