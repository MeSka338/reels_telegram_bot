import { detectPlatform } from "./detectPlatform.js";

/** Returns true only for a supported, video-shaped public URL. */
export function isSupportedVideoUrl(value: string): boolean {
  return detectPlatform(value.trim()) !== null;
}
