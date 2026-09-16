import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";

let activeProcess: ChildProcess | null = null;
let activeTempDir: string | null = null;

export type DownloadOptions = {
  onDownloadProgress?: (percent: number) => void;
  onProcessingProgress?: (percent: number) => void;
  maxDurationSeconds?: number;
  maxFileSizeBytes?: number;
};

export const DEFAULT_MAX_DURATION_SECONDS = 10 * 60;
export const DEFAULT_MAX_FILE_SIZE_BYTES = 45 * 1024 * 1024;

// -------------------------
// Получение длительности видео
// -------------------------

function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);

    let output = "";
    let errorOutput = "";

    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      errorOutput += data.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe завершился с кодом ${code}: ${errorOutput}`));
        return;
      }

      const duration = Number.parseFloat(output.trim());

      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("Не удалось определить длительность видео"));
        return;
      }

      resolve(duration);
    });
  });
}

// -------------------------
// yt-dlp
// -------------------------

function downloadVideo(
  url: string,
  outputFile: string,
  maxFileSizeBytes: number,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", [
      "--impersonate",
      "Chrome-133:Macos-15",

      "-f",
      "bv*+ba/b",

      "--merge-output-format",
      "mp4",

      "--no-playlist",

      "--max-filesize",
      `${Math.floor(maxFileSizeBytes / (1024 * 1024))}M`,

      "--newline",

      "--progress-template",
      "download:%(progress._percent_str)s",

      "-o",
      outputFile,

      url,
    ]);

    activeProcess = child;

    let buffer = "";

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString();

      process.stdout.write(text);

      buffer += text;

      const lines = buffer.split("\n");

      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("download:")) {
          continue;
        }

        const value = line.replace("download:", "").replace("%", "").trim();

        const percent = Number.parseFloat(value);

        if (!Number.isNaN(percent)) {
          onProgress?.(Math.min(100, Math.max(0, percent)));
        }
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      process.stderr.write(data.toString());
    });

    child.on("error", (error) => {
      activeProcess = null;
      reject(error);
    });

    child.on("close", (code) => {
      activeProcess = null;

      if (code === 0) {
        onProgress?.(100);
        resolve();
        return;
      }

      reject(new Error(`yt-dlp завершился с кодом ${code}`));
    });
  });
}

// -------------------------
// FFmpeg + реальный progress
// -------------------------

function processVideo(
  inputFile: string,
  outputFile: string,
  duration: number,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",

      "-i",
      inputFile,

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

      "-progress",
      "pipe:1",

      "-nostats",

      outputFile,
    ]);

    activeProcess = child;

    let buffer = "";

    child.stdout.on("data", (data: Buffer) => {
      buffer += data.toString();

      const lines = buffer.split("\n");

      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("out_time=")) {
          continue;
        }

        const time = line.replace("out_time=", "").trim();

        const parts = time.split(":");

        if (parts.length !== 3) {
          continue;
        }

        const hours = Number(parts[0]);
        const minutes = Number(parts[1]);
        const seconds = Number(parts[2]);

        const currentTime = hours * 3600 + minutes * 60 + seconds;

        if (!Number.isFinite(currentTime)) {
          continue;
        }

        const percent = (currentTime / duration) * 100;

        onProgress?.(Math.min(100, Math.max(0, percent)));
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      // FFmpeg пишет служебную информацию в stderr.
      process.stderr.write(data.toString());
    });

    child.on("error", (error) => {
      activeProcess = null;
      reject(error);
    });

    child.on("close", (code) => {
      activeProcess = null;

      if (code === 0) {
        onProgress?.(100);
        resolve();
        return;
      }

      reject(new Error(`ffmpeg завершился с кодом ${code}`));
    });
  });
}

// -------------------------
// Cleanup
// -------------------------

async function cleanup() {
  if (activeProcess) {
    console.log("🛑 Останавливаю активный процесс...");

    const child = activeProcess;
    child.kill("SIGTERM");

    const stopped = await Promise.race([
      once(child, "close").then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
    ]);

    if (!stopped && child.exitCode === null) {
      child.kill("SIGKILL");
      await once(child, "close");
    }

    if (activeProcess === child) activeProcess = null;
  }

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

/** Removes incomplete jobs left behind by an unclean container restart. */
export async function cleanupStaleTempDirs(): Promise<void> {
  const tempRoot = path.resolve("temp");
  await mkdir(tempRoot, { recursive: true });

  const entries = await readdir(tempRoot, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => rm(path.join(tempRoot, entry.name), { recursive: true, force: true })),
  );
}

// -------------------------
// Основная функция
// -------------------------

export async function downloadReel(
  url: string,
  options: DownloadOptions = {},
): Promise<string> {
  const id = randomUUID();

  const tempDir = path.resolve("temp", id);

  activeTempDir = tempDir;

  await mkdir(tempDir, {
    recursive: true,
  });

  const originalFile = path.join(tempDir, "original.mp4");

  const outputFile = path.join(tempDir, "video.mp4");
  const maxDurationSeconds =
    options.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;

  try {
    // -------------------------
    // 1. Download
    // -------------------------

    console.log("⬇️ Скачиваю видео...");

    await downloadVideo(
      url,
      originalFile,
      maxFileSizeBytes,
      options.onDownloadProgress,
    );

    const originalSize = (await stat(originalFile)).size;
    if (originalSize > maxFileSizeBytes) {
      throw new Error("Исходное видео превышает допустимый размер");
    }

    // -------------------------
    // 2. Duration
    // -------------------------

    console.log("🔎 Получаю информацию о видео...");

    const duration = await getVideoDuration(originalFile);

    if (duration > maxDurationSeconds) {
      throw new Error("Видео превышает допустимую длительность");
    }

    console.log(`Длительность: ${duration.toFixed(2)} сек.`);

    // -------------------------
    // 3. FFmpeg
    // -------------------------

    console.log("⚙️ Обрабатываю видео...");

    options.onProcessingProgress?.(0);

    await processVideo(
      originalFile,
      outputFile,
      duration,
      options.onProcessingProgress,
    );

    const outputSize = (await stat(outputFile)).size;
    if (outputSize > maxFileSizeBytes) {
      throw new Error("Обработанное видео превышает допустимый размер");
    }

    console.log("✅ Видео готово:", outputFile);

    // -------------------------
    // 4. Original cleanup
    // -------------------------

    await unlink(originalFile);

    activeTempDir = null;

    return outputFile;
  } catch (error) {
    console.error("Ошибка обработки видео:", error);

    await rm(tempDir, {
      recursive: true,
      force: true,
    });

    activeTempDir = null;

    throw new Error("Не удалось скачать или обработать видео");
  }
}
