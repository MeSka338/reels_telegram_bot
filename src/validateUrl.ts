export function isInstagramReelUrl(value: string): boolean {
  try {
    const url = new URL(value);

    const isInstagram =
      url.hostname === "instagram.com" || url.hostname === "www.instagram.com";

    const isReel =
      url.pathname.startsWith("/reel/") || url.pathname.startsWith("/reels/");

    return isInstagram && isReel;
  } catch {
    return false;
  }
}
