// 验证「Hero 播放键 → 直接进播放器」这条链路（开发用）
import { build, createServer } from "vite";
import { chromium } from "playwright-core";
import { installTvFixture } from "../tests/tv-remote-fixture.mjs";
process.env.VITE_APP_EDITION = "tv";
const root = "/opt/data/cache/scratch/HGhubTV";
await build({ root, logLevel: "silent" });
const vite = await createServer({ root, server: { host: "127.0.0.1", port: 0 } });
await vite.listen();
const base = vite.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
await ctx.route("**/*", r => {
  const u = new URL(r.request().url());
  if (u.origin === base) return r.continue();
  if (u.port === "17650" || u.pathname === "/img") return r.fulfill({ status: 200, contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#243a4c"/></svg>' });
  return r.fulfill({ status: 200, body: "" });
});
await ctx.addInitScript(installTvFixture, { accepted: true });
const page = await ctx.newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
await page.goto(`${base}/`);
await page.waitForTimeout(4500);
const before = await page.evaluate(() => ({ hero: !!document.querySelector(".tv-hero"), player: !!document.querySelector(".tv-player, video"),
  focus: document.activeElement?.getAttribute?.("data-tv-focus") || document.activeElement?.tagName }));
console.log("启动后:", JSON.stringify(before));
await page.locator('[data-tv-focus="hero-play"]').click();
await page.waitForTimeout(3000);
const after = await page.evaluate(() => ({
  player: !!document.querySelector(".tv-player, video"),
  video: !!document.querySelector("video"),
  detail: !!document.querySelector(".tv-detail-route"),
  src: (document.querySelector("video")?.currentSrc || "").slice(0, 60),
  msg: (document.querySelector(".tv-player-message")?.textContent || "").slice(0, 60),
}));
console.log("点播放后:", JSON.stringify(after));
await page.screenshot({ path: "/opt/data/cache/scratch/play-probe.png" });
await browser.close(); await vite.close();
