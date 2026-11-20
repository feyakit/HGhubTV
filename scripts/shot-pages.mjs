import { build, createServer } from "vite";
import { chromium } from "playwright-core";
import { installTvFixture } from "/opt/data/cache/scratch/HGhubTV/tests/tv-remote-fixture.mjs";
process.env.VITE_APP_EDITION = "tv";
const root = "/opt/data/cache/scratch/HGhubTV";
await build({ root, logLevel: "silent" });
const vite = await createServer({ root, server: { host: "127.0.0.1", port: 0 } });
await vite.listen();
const origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
await ctx.route("**/*", async r => {
  const u = new URL(r.request().url());
  if (u.origin === origin) return r.continue();
  // 用彩色封面，避免蓝色占位图干扰配色判断
  if (u.pathname === "/img") return r.fulfill({ status: 200, contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9762e"/><stop offset=".5" stop-color="#8a3f2a"/><stop offset="1" stop-color="#23384d"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/></svg>' });
  return r.abort();
});
await ctx.addInitScript(installTvFixture, { accepted: true });
const page = await ctx.newPage();
await page.goto(`${origin}/`);
await page.waitForTimeout(6000);
const shot = async (name) => { await page.screenshot({ path: `/opt/data/cache/scratch/v-${name}.png` }); console.log("shot", name); };
await shot("home");
// 进详情
await page.keyboard.press("ArrowDown"); await page.waitForTimeout(500);
await page.keyboard.press("Enter"); await page.waitForTimeout(3000);
await shot("detail");
// 逐页截侧栏里的四个页面，看氛围层效果
const nav = async (id, name) => {
  await page.click(`[data-tv-focus="nav-${id}"]`);
  await page.waitForTimeout(4000);
  await shot(name);
};
await nav("browse", "browse");
await nav("library", "library");
await nav("search", "search");
await nav("settings", "settings");
await browser.close(); await vite.close();
