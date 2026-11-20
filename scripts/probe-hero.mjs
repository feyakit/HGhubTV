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
const W = Number(process.env.PROBE_W || 1280), H = Number(process.env.PROBE_H || 720);
const context = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" });
console.log(JSON.stringify({ viewport: `${W}x${H}` }));
await context.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.origin === origin) return route.continue();
  if (url.port === "17650" && url.pathname === "/img")
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d5f78"/><stop offset=".5" stop-color="#8a5a3c"/><stop offset="1" stop-color="#1b2733"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="880" cy="300" r="190" fill="#00000033"/></svg>' });
  if (url.origin === "http://hg.localhost" && url.pathname === "/img")
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b4a63"/><stop offset="1" stop-color="#101a24"/></linearGradient></defs><rect width="240" height="360" fill="url(#g)"/></svg>' });
  return route.abort();
});
await context.addInitScript(installTvFixture, { accepted: true });
/* 种一条观看记录（片库存在 IndexedDB），否则 probe 里永远看不到续播态 */
await context.addInitScript(() => {
  const open = indexedDB.open("hghubx-tv-library-v1", 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains("library")) db.createObjectStore("library", { keyPath: "key" });
    if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
  };
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction("library", "readwrite");
    tx.objectStore("library").put({
      key: "video:1",
      content: { kind: "video", id: 1, title: "我的时间", cover: "/img", score: 8.5, episodeCount: 2, tags: [] },
      progress: { key: "video:1", part: "1", seconds: 520, duration: 1280, updatedAt: Date.now() },
      favorite: false,
    });
  };
});const page = await context.newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
await page.goto(`${origin}/`);
await page.waitForTimeout(5000);
const info = await page.evaluate(() => {
  const hero = document.querySelector(".tv-hero");
  const art = document.querySelector(".tv-hero-art");
  const r = hero?.getBoundingClientRect();
  return {
    heroCount: document.querySelectorAll(".tv-hero").length,
    rect: r ? { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) } : null,
    title: document.querySelector(".tv-hero-title")?.textContent || null,
    artBg: art ? getComputedStyle(art).backgroundImage.slice(0, 70) : null,
    shelfTitles: Array.from(document.querySelectorAll(".tv-shelf h2")).map(h => h.textContent).slice(0, 4),
    cardCount: document.querySelectorAll(".tv-shelf .tv-card").length,
    heroBodyTop: Math.round(document.querySelector(".tv-hero-body")?.getBoundingClientRect().top ?? -1),
    heroBodyH: Math.round(document.querySelector(".tv-hero-body")?.offsetHeight ?? -1),
    heroParts: Array.from(document.querySelector(".tv-hero-body")?.children ?? []).map((el) => `${el.className}:${Math.round(el.offsetHeight)}`).join(" | "),
    heroH: Math.round(document.querySelector(".tv-hero")?.offsetHeight ?? -1),
    navBottom: Math.round(document.querySelector(".tv-topnav")?.getBoundingClientRect().bottom ?? -1),
    titleTop: Math.round(document.querySelector(".tv-hero-title")?.getBoundingClientRect().top ?? -1),
    parts: Array.from(document.querySelector(".tv-hero-body")?.children || []).map(c => ({
      cls: c.className, h: Math.round(c.getBoundingClientRect().height) })),
    navH: Math.round(document.querySelector(".tv-topnav")?.getBoundingClientRect().height ?? -1),
    vh: window.innerHeight,
    boxes: Array.from(document.querySelectorAll(".tv-shelf")).slice(0,2).map(sec => {
      const card = sec.querySelector(".tv-card");
      const r = card?.getBoundingClientRect();
      return { title: sec.querySelector("h2")?.textContent,
        secTop: Math.round(sec.getBoundingClientRect().top),
        artBottom: r ? Math.round(r.top + (card.querySelector(".tv-card-art")?.getBoundingClientRect().height ?? 0)) : -1,
        cardBottom: r ? Math.round(r.bottom) : -1,
        strongBottom: Math.round(card?.querySelector("strong")?.getBoundingClientRect().bottom ?? -1),
        smallBottom: Math.round(card?.querySelector("small")?.getBoundingClientRect().bottom ?? -1) };
    }),
  };
});
console.log(JSON.stringify(info, null, 1));
/* 自动聚焦会把页面滚下去，截图前先回顶，否则看到的是滚动态 */
await page.evaluate(() => document.querySelector(".tv-page-scroll")?.scrollTo(0, 0));
await page.waitForTimeout(400);
await page.screenshot({ path: "/opt/data/cache/scratch/hero-live.png" });
await browser.close(); await vite.close();
