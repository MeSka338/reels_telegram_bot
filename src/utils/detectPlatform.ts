export type Platform = "instagram" | "youtube" | "tiktok" | "vk";

export function detectPlatform(url: string): Platform | null {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    // Instagram Reels
    if (
      (hostname === "instagram.com" || hostname === "m.instagram.com") &&
      (pathname.startsWith("/reel/") || pathname.startsWith("/reels/"))
    ) {
      return "instagram";
    }

    // YouTube
    if (
      hostname === "youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "youtu.be"
    ) {
      return "youtube";
    }

    // TikTok
    if (
      hostname === "tiktok.com" ||
      hostname === "m.tiktok.com" ||
      hostname === "vm.tiktok.com" ||
      hostname === "vt.tiktok.com"
    ) {
      return "tiktok";
    }

    // VK
    if (
      hostname === "vk.com" ||
      hostname === "m.vk.com" ||
      hostname === "vkvideo.ru"
    ) {
      return "vk";
    }

    return null;
  } catch {
    return null;
  }
}
