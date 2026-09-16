import test from "node:test";
import assert from "node:assert/strict";

import { detectPlatform } from "../src/utils/detectPlatform.js";
import { isSupportedVideoUrl } from "../src/utils/validateUrl.js";

test("recognizes supported video URLs", () => {
  assert.equal(detectPlatform("https://www.instagram.com/reel/ABC123/"), "instagram");
  assert.equal(detectPlatform("https://youtu.be/abc123"), "youtube");
  assert.equal(detectPlatform("https://www.youtube.com/watch?v=abc123"), "youtube");
  assert.equal(detectPlatform("https://www.tiktok.com/@creator/video/123456"), "tiktok");
  assert.equal(detectPlatform("https://vk.com/video-1_2"), "vk");
});

test("rejects platform homepages and non-video URLs", () => {
  for (const value of [
    "https://youtube.com/",
    "https://instagram.com/p/photo/",
    "https://tiktok.com/@creator",
    "https://example.com/video",
    "not a url",
  ]) {
    assert.equal(detectPlatform(value), null);
    assert.equal(isSupportedVideoUrl(value), false);
  }
});
