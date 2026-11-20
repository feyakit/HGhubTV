/* 逐条实测测试报告里的 10 个问题。
   只读：不修改产物，只驱动按键并读取 DOM 状态。 */
import { build, createServer } from "vite";
import { chromium } from "playwright-core";
import { installTvFixture } from "../tests/tv-remote-fixture.mjs";

process.env.VITE_APP_EDITION = "tv";
const root = "/opt/data/cache/scratch/HGhubTV";
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
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#3d5f78"/></svg>' });
  if (url.origin === "http://hg.localhost" && url.pathname === "/img")
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#2b4a63"/></svg>' });
  return route.abort();
});
await context.addInitScript(installTvFixture, { accepted: true });
const page = await context.newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
await page.goto(`${origin}/`);
await page.waitForTimeout(4000);

const info = () => page.evaluate(() => {
  const a = document.activeElement;
  const topbar = document.querySelector(".tv-topbar");
  const tb = topbar?.getBoundingClientRect();
  const ts = topbar ? getComputedStyle(topbar) : null;
  return {
    focus: a?.getAttribute("data-tv-focus") || a?.textContent?.trim().slice(0, 24) || null,
    focusRegion: a?.closest("[data-tv-region]")?.getAttribute("data-tv-region") || null,
    /* 真实可见性：类名还在不代表被藏起来了，看渲染结果。 */
    topbarVisible: !!topbar && Number(ts.opacity) > .5 && (tb ? tb.bottom > 0 : false),
    topbarScrolled: topbar?.classList.contains("is-scrolled") || false,
    topbarExists: !!topbar,
    hasRelated: !!document.querySelector(".tv-detail-related, [class*=related]"),
    scrollTop: document.querySelector(".tv-page-scroll:not([hidden])")?.scrollTop ?? null,
  };
});
const press = async (key, times = 1) => { for (let i = 0; i < times; i++) { await page.keyboard.press(key); await page.waitForTimeout(260); } };
const log = (tag, extra = {}) => page.evaluate(() => {}).then(() => info()).then(o => console.log(JSON.stringify({ step: tag, ...o, ...extra })));

const results = {};
results.homeInitial = await info();
await press("ArrowDown", 3);
results.homeScrolled = await info();

// 进详情页：直接点推荐行卡片（Hero 主按钮会直接进播放器）
await page.evaluate(() => {
  const card = document.querySelector(".tv-shelf .tv-card, .tv-card");
  card?.click();
});
await page.waitForTimeout(2500);
results.afterCardClick = await info();
results.pageKind = await page.evaluate(() =>
  document.querySelector(".tv-player") ? "player"
  : document.querySelector(".tv-detail-route, .tv-detail") ? "detail" : "other");

if (results.pageKind === "detail") {
  // N-HG-01：初始焦点与按下的落点
  results.detailInitial = await info();
  const d0 = await page.evaluate(() => Array.from(document.querySelectorAll(".tv-detail-actions button")).map(b => ({ t: b.textContent.trim(), disabled: b.disabled })));
  results.detailActionButtons = d0;
  await press("ArrowDown");
  results.detailAfterDown = await info();
  await press("ArrowDown");
  results.detailAfterDown2 = await info();
  // N-HG-09
  results.detailHasRelated = (await info()).hasRelated;
  // 回到播放按钮：直接聚焦后确认
  await page.evaluate(() => document.querySelector(".tv-detail-actions button.tv-primary")?.focus());
  await press("Enter");
  await page.waitForTimeout(3000);
  results.enteredPlayer = await page.evaluate(() => !!document.querySelector(".tv-player"));
  if (results.enteredPlayer) {
    // N-HG-02：选集按钮状态
    const btns = await page.evaluate(() => Array.from(document.querySelectorAll(".tv-player button")).map(b => ({ t: b.textContent.trim().slice(0, 10), f: b.getAttribute("data-tv-focus"), disabled: b.disabled })));
    results.playerButtons = btns;
    // 唤出控制层
    await press("Enter");
    await page.waitForTimeout(600);
    const partsBtn = await page.evaluate(() => {
      const b = document.querySelector('[data-tv-focus="player:parts"]');
      return b ? { exists: true, disabled: b.disabled, inDom: true } : { exists: false };
    });
    results.partsButton = partsBtn;
    // 点它，看是否开 modal
    await page.evaluate(() => document.querySelector('[data-tv-focus="player:parts"]')?.click());
    await page.waitForTimeout(900);
    results.afterPartsClick = await page.evaluate(() => ({
      modal: document.querySelector('[data-tv-modal="player-parts"]') ? "parts-open" : (document.querySelector(".tv-player") ? "player-still" : "left-player"),
      modalIds: Array.from(document.querySelectorAll("[data-tv-modal]")).map(e => e.getAttribute("data-tv-modal")),
    }));
    // N-HG-03：控制层隐藏时左右键是否预览 seek
    await press("Escape");
    await page.waitForTimeout(400);
    const beforeSeek = await page.evaluate(() => ({
      hint: !!document.querySelector(".tv-player-seek-hint"),
      time: document.querySelector(".tv-player-time, [class*=time]")?.textContent || null,
      part: document.querySelector("[class*=part-label], .tv-player-title")?.textContent?.slice(0, 20) || null,
    }));
    await press("ArrowRight", 1);
    const afterRight = await page.evaluate(() => ({
      hint: !!document.querySelector(".tv-player-seek-hint"),
      hintText: document.querySelector(".tv-player-seek-hint")?.textContent || null,
      controlVisible: !!document.querySelector(".tv-player-controls"),
    }));
    results.seekTest = { beforeSeek, afterRight };
    await press("ArrowRight", 2);
    results.seekAfter3 = await page.evaluate(() => ({
      hintText: document.querySelector(".tv-player-seek-hint")?.textContent || null,
      partLabel: document.querySelector(".tv-player-title, [class*=part]")?.textContent?.slice(0, 30) || null,
    }));
  }
}

// N-HG-07：搜索页结果
await press("Escape", 2);
await page.evaluate(() => { const b = document.querySelector('[data-tv-focus="nav-search"]'); b?.click(); });
await page.waitForTimeout(1200);
results.searchPage = await info();
await page.evaluate(() => { const hot = document.querySelector(".tv-search-hot button, [class*=hot] button"); hot?.click(); });
await page.waitForTimeout(2500);
results.searchResults = await info();
await page.evaluate(() => { const sc = document.querySelector(".tv-page-scroll:not([hidden])"); if (sc) sc.scrollTop = 300; });
await page.waitForTimeout(700);
results.searchResultsScrolled = await info();

await browser.close(); await vite.close();
console.log("RESULTS " + JSON.stringify(results, null, 1));
console.log("DONE");
