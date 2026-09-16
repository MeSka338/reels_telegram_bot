export type Platform = "instagram" | "youtube" | "tiktok" | "vk";

export function detectPlatform(url: string): Platform | null {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    if (
      (hostname === "instagram.com" || hostname === "m.instagram.com") &&
      /^\/reels?\/[^/]+\/?$/.test(pathname)
    ) {
      return "instagram";
    }

    if (
      (hostname === "youtu.be" && pathname.length > 1) ||
      ((hostname === "youtube.com" || hostname === "m.youtube.com") &&
        ((pathname === "/watch" && parsedUrl.searchParams.has("v")) ||
          /^\/(shorts|live|embed)\/[^/]+\/?$/.test(pathname)))
    ) {
      return "youtube";
    }

    if (
      (hostname === "tiktok.com" && /^\/@[^/]+\/video\/\d+\/?$/.test(pathname)) ||
      ((hostname === "vm.tiktok.com" || hostname === "vt.tiktok.com") &&
        pathname.length > 1)
    ) {
      return "tiktok";
    }

    if (
      ((hostname === "vk.com" || hostname === "m.vk.com") && /^\/(video|clip)/.test(pathname)) ||
      (hostname === "vkvideo.ru" && pathname.length > 1)
    ) {
      return "vk";
    }

    return null;
  } catch {
    return null;
  }
}
