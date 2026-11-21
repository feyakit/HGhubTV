/* 截焦点态对比图：同一张卡片的聚焦/未聚焦效果各一张。 */
import { build, createServer } from "vite";
import { chromium } from "playwright-core";
import { installTvFixture } from "../tests/tv-remote-fixture.mjs";

process.env.VITE_APP_EDITION = "tv";
const root = "/opt/data/cache/scratch/HGhubTV-check";
await build({ root, logLevel: "silent" });
const vite = await createServer({ root, server: { host: "127.0.0.1", port: 0 } });
await vite.listen();
const origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 636 }, reducedMotion: "reduce", deviceScaleFactor: 2 })).newPage();
await page.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.origin === origin) return route.continue();
  const colors = ["#3d5f78", "#8a5a3c", "#2b4a63", "#4a3b5c", "#1b2733"];
  const hue = colors[Math.abs(url.pathname.length) % colors.length];
  return route.fulfill({ status: 200, contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="${hue}"/></svg>` });
});
await page.addInitScript(installTvFixture, { accepted: true });
await page.goto(`${origin}/`);
await page.waitForTimeout(4500);

// 未聚焦的货架
await page.evaluate(() => document.querySelector('[data-tv-focus="nav-home"]')?.focus());
await page.waitForTimeout(400);
await page.screenshot({ path: "/opt/data/cache/scratch/shots315/focus-off.png", clip: { x: 0, y: 380, width: 1280, height: 250 } });

// 聚焦第一张卡
await page.evaluate(() => document.querySelector('[data-tv-region="home-推荐"] .tv-card')?.focus());
await page.waitForTimeout(400);
await page.screenshot({ path: "/opt/data/cache/scratch/shots315/focus-on.png", clip: { x: 0, y: 380, width: 1280, height: 250 } });

// 详情页按钮焦点
await page.evaluate(() => document.querySelector('[data-tv-region="home-推荐"] .tv-card')?.click());
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('.tv-detail-actions .tv-primary')?.focus());
await page.waitForTimeout(400);
await page.screenshot({ path: "/opt/data/cache/scratch/shots315/focus-detail.png", clip: { x: 0, y: 250, width: 1280, height: 260 } });

await browser.close(); await vite.close();
console.log("shots written");
