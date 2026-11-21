/* 检查首页各货架之间有没有重复卡片。
   跑法：BROWSER_EXECUTABLE=... node scripts/probe-dupes.mjs */
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
const W = Number(process.env.PROBE_W || 1280), H = Number(process.env.PROBE_H || 636);
const context = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" });
await context.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.origin === origin) return route.continue();
  if (url.port === "17650" && url.pathname === "/img")
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#2b4a63"/></svg>' });
  if (url.origin === "http://hg.localhost" && url.pathname === "/img")
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#2b4a63"/></svg>' });
  return route.abort();
});
await context.addInitScript(installTvFixture, { accepted: true });
const page = await context.newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
await page.goto(`${origin}/`);
await page.waitForTimeout(5000);

const report = await page.evaluate(() => {
  const shelves = [...document.querySelectorAll(".tv-shelf")].map(section => ({
    title: section.querySelector("h2")?.textContent?.trim() || "",
    keys: [...section.querySelectorAll(".tv-card")].map(card => card.getAttribute("data-tv-focus")),
  }));
  const all = shelves.flatMap(shelf => shelf.keys);
  const counts = new Map();
  all.forEach(key => counts.set(key, (counts.get(key) || 0) + 1));
  const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([key, n]) => `${key}×${n}`);
  return {
    shelves: shelves.map(shelf => `${shelf.title}:${shelf.keys.length}`),
    total: all.length,
    unique: counts.size,
    dupes,
  };
});
console.log("DUPLICATES " + JSON.stringify(report, null, 1));
await browser.close(); await vite.close();
