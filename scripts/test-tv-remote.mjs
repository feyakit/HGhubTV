// Executed by the existing GitHub Actions playback workflow with scenarios=tv.
// Real TV bootstrap/components/Worker/IndexedDB. All IPC/media remain fixtures.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import { chromium } from "playwright-core";
import { installTvFixture } from "../tests/tv-remote-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "test-results", "tv-remote", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const report = { environment: "Chromium actual TV edition; strict mock IPC; generated local MP4; no upstream", cases: [], errors: [], external: [], screenshots: [] };
let vite, browser, mediaDirectory, origin;
const contexts = [];
let activeContext;
const savedEdition = process.env.VITE_APP_EDITION;
async function scenario(name, run) {
  const item = { name, status: "running" }; report.cases.push(item);
  try { item.metrics = await run(); item.status = "passed"; console.log(`PASS TV ${name}`); }
  catch (error) { item.status = "failed"; item.error = String(error.stack || error); throw error; }
  finally {
    if (activeContext) {
      for (const page of activeContext.pages()) {
        const unknown = await page.evaluate(() => window.__tvFixture?.unknown || []).catch(() => []);
        report.errors.push(...unknown.map(command => `Unexpected fixture IPC: ${command}`));
        if (item.status === "failed") await page.screenshot({ path: join(output, `${name}-failed.png`) }).catch(() => {});
      }
      await activeContext.tracing.stop({ path: join(output, `${name}-trace.zip`) }).catch(() => {});
      await activeContext.close();
      contexts.splice(contexts.indexOf(activeContext), 1); activeContext = undefined;
    }
    await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  }
}
async function open({ accepted = true, isolated = false, width = 1280, height = 720 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", userAgent: "Mozilla/5.0 (Linux; Android 12; TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });
  contexts.push(context);
  activeContext = context;
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", error => report.errors.push(error.message));
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.origin === "http://hg.localhost" && url.pathname === "/img") return route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#234960"/><path d="M95 140L160 180L95 220Z" fill="#60cdff"/></svg>' });
    if (url.origin === "http://hg.localhost" && url.pathname === "/seg") {
      const data = await readFile(join(mediaDirectory, "fixture.mp4"));
      const range = route.request().headers().range;
      const match = /^bytes=(\d+)-(\d*)$/.exec(range || "");
      if (match) {
        const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
        return route.fulfill({ status: 206, contentType: "video/mp4", headers: { "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${data.length}` }, body: data.subarray(start, end + 1) });
      }
      return route.fulfill({ status: 200, contentType: "video/mp4", headers: { "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes" }, body: data });
    }
    if (url.protocol === "blob:" || url.protocol === "data:") return route.continue();
    report.external.push(url.href); return route.abort("blockedbyclient");
  });
  await page.addInitScript(installTvFixture, { accepted });
  await page.goto(`${origin}${isolated ? "/tests/tv-remote.html" : "/"}`);
  if (!isolated && accepted) await page.locator('[data-tv-focus="nav-home"]').waitFor();
  return { context, page };
}
const activate = async (page, key) => {
  const element = page.locator(`[data-tv-focus=${JSON.stringify(key)}]`).filter({ visible: true }).first();
  await page.waitForFunction(key => {
    const element = [...document.querySelectorAll("[data-tv-focus]")].find(item => item.getAttribute("data-tv-focus") === key && item.getClientRects().length);
    return !!element && !element.matches(":disabled");
  }, key);
  await element.focus(); await page.keyboard.press("Enter");
};
const calls = (page, command) => page.evaluate(command => window.__tvFixture.calls.filter(call => call.command === command), command);
const activeKey = page => page.evaluate(() => document.activeElement?.getAttribute("data-tv-focus"));
const screenshot = async (page, file) => {
  await page.screenshot({ path: join(output, file), animations: "disabled" });
  report.screenshots.push(file);
};
const catalogStatus = page => page.evaluate(async () => {
  const request = indexedDB.open("hghubx-tv-catalog-v1", 1);
  const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const read = db.transaction("checkpoints", "readonly").objectStore("checkpoints").get(window.__tvFixture.base);
  const value = await new Promise((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); }); db.close(); return value;
});
try {
  process.env.VITE_APP_EDITION = "tv";
  mediaDirectory = await mkdtemp(join(tmpdir(), "hghubx-tv-media-"));
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10", "-t", "60", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(mediaDirectory, "fixture.mp4")], { timeout: 60000 });
  vite = await createServer({ root, cacheDir: join(root, "node_modules/.vite-tv-remote"),
    // Worker-only dependencies otherwise arrive after the first page has mounted
    // and Vite can invalidate its optimized graph in the middle of a scenario.
    optimizeDeps: { include: ["pinyin-pro"] },
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, open: false } });
  await vite.listen(); origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || chromium.executablePath(), args: ["--autoplay-policy=no-user-gesture-required"] });
  report.browser = browser.version();
  await scenario("startup-skips-agreement", async () => {
    /* 协议页已从启动流程移除：自用免费版不再拦截，条款文本仅在设置页可查。
       这里验证「本地没有任何同意记录」时也直接进首页，且不重复挂键盘监听。 */
    const { page } = await open({ accepted: false });
    await page.locator('[data-tv-focus="nav-home"]').waitFor();
    assert.equal(await page.locator('[data-tv-focus="agreement-checkbox"]').count(), 0, "启动不该再出现协议页");
    const pre = await page.evaluate(() => ({ ready: window.__tvFixture.startupReady, keys: window.__tvFixture.keyboardListeners,
      native: window.__tvFixture.nativeListeners }));
    assert.equal(pre.ready, 1); assert.equal(pre.keys, 1); assert.equal(pre.native, 1);
    assert.equal((await calls(page, "app_boot")).length, 1);
    assert.equal(await page.locator("#hg-startup-error").count(), 0);
    return pre;
  });
  await scenario("nav-switch-syncs-page", async () => {
    /* 用户反馈：点左侧菜单，右侧画面不跟着换。这里逐项点过去，
       断言「可见的页面只有一个，且就是当前菜单那一页」。 */
    const { page } = await open();
    await page.locator('[data-tv-focus="nav-home"]').waitFor();
    for (const id of ["browse", "library", "settings", "home"]) {
      await page.locator(`[data-tv-focus="nav-${id}"]`).click();
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => {
        const pages = [...document.querySelectorAll(".tv-page-scroll")];
        const shown = pages.filter(node => node.offsetParent !== null);
        const current = document.querySelector('[data-tv-region="navigation"] button[aria-current="page"]');
        return { total: pages.length, shown: shown.map(node => node.dataset.tvScrollId), current: current?.getAttribute("data-tv-focus") || null };
      });
      assert.equal(state.shown.length, 1, `切到 ${id} 后可见页面应只有一个，实际 ${JSON.stringify(state.shown)}`);
      assert.equal(state.shown[0], `page-${id}`, `切到 ${id} 后右侧应是 page-${id}，实际 ${state.shown[0]}`);
      assert.equal(state.current, `nav-${id}`, `左侧高亮应是 nav-${id}，实际 ${state.current}`);
      /* 切完之后焦点必须还留在菜单上：否则用户接着按上下就切不了菜单
         （实测「切一次之后菜单就切不动」，焦点被扔进了内容区）。 */
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-tv-focus"));
      assert.equal(focused, `nav-${id}`, `切到 ${id} 后焦点应停在 nav-${id}，实际 ${focused}`);
    }
    /* 纯遥控器路径：顶部横向导航连续 右+确认 应一路切过去，而不是卡在第一个 */
    await page.locator('[data-tv-focus="nav-home"]').focus();
    await page.keyboard.press("Enter");
    for (const expected of ["nav-browse", "nav-search", "nav-library"]) {
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(250);
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-tv-focus"));
      assert.equal(focused, expected, `遥控器连续切换应停在 ${expected}，实际 ${focused}`);
    }
  });
  await scenario("keyboard-focus-modal-tag-gate", async () => {
    const { page } = await open();
    const card = page.locator('[data-tv-region="home-推荐"] [data-tv-focus="video:1"]');
    await card.waitFor(); await card.focus(); await page.keyboard.press("Enter");
    await page.locator('[data-tv-focus="detail:video:1:more"]').waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-tv-focus="detail:video:1:more"]')?.disabled);
    await screenshot(page, "detail-1280x720.png");
    await activate(page, "detail:video:1:more");
    await page.getByRole("dialog", { name: "屏蔽标签" }).waitFor();
    for (const key of ["Tab", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Tab"]) {
      await page.keyboard.press(key);
      assert(await page.evaluate(() => !!document.activeElement?.closest('[data-tv-modal="detail-tags:video:1"]')), "Modal must own focus");
    }
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-tv-focus") === "detail:video:1:more");
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.__tvFixture.back(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
    });
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-tv-focus") === "video:1" && !!document.activeElement?.closest('[data-tv-region="home-推荐"]'));
    assert.equal(await page.evaluate(() => window.__tvFixture.exits), 0, "Native and keyboard back pair must pop once");
    await page.keyboard.press("Enter"); await activate(page, "detail:video:1:more");
    await activate(page, "block:都市"); await activate(page, "block-confirm");
    await page.getByRole("heading", { name: "内容已屏蔽" }).waitFor();
    assert.equal(await page.locator(".tv-detail-cover img").count(), 0); assert.equal(await page.locator("video").count(), 0);
    return { focusRestored: true, modalTrapped: true, duplicateBackSuppressed: true, blockedMediaUnmounted: true };
  });
  /* 详情页是异步拉的：parts 到达前播放按钮 disabled，restoreFocus 拿不到
     data-tv-initial，初始焦点会掉到「返回列表」——遥控器用户从此走不到播放/
     收藏/选集/更多。这条守住两点：数据到达后焦点必须落在操作行；从播放按钮
     按「下」不能把人送回返回列表。 */
  await scenario("detail-focus-reaches-action-row", async () => {
    const { page } = await open();
    const card = page.locator('[data-tv-region="home-推荐"] [data-tv-focus="video:1"]');
    await card.waitFor(); await card.focus(); await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector('[data-tv-focus="detail:video:1:play"]')?.disabled);
    await page.waitForTimeout(400);
    const initial = await activeKey(page);
    assert.ok(/^detail:video:1:(play|favorite|episodes|more)$/.test(initial || ""), `详情页初始焦点应落在操作行，实际 ${initial}`);
    await page.evaluate(() => document.querySelector('[data-tv-focus="detail:video:1:play"]')?.focus());
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);
    const after = await activeKey(page);
    assert.ok(!String(after).endsWith(":back"), `从播放按钮按「下」不该回到返回列表，实际 ${after}`);
    assert.ok(/^detail:video:1:part:/.test(after || ""), `从播放按钮按「下」应进选集区，实际 ${after}`);
    return { initialFocus: initial, afterDown: after };
  });
  /* 相关推荐：附录在选集区下方，遥控器继续按「下」要能落到上面，点开是新的详情。 */
  await scenario("detail-related-row", async () => {
    const { page } = await open();
    const card = page.locator('[data-tv-region="home-推荐"] [data-tv-focus="video:1"]');
    await card.waitFor(); await card.focus(); await page.keyboard.press("Enter");
    await page.locator('[data-tv-region="detail-related"]').waitFor({ timeout: 8000 });
    const items = await page.locator('[data-tv-region="detail-related"] [data-tv-focus]').count();
    assert.ok(items > 0, `相关推荐应有卡片，实际 ${items}`);
    const self = await page.locator('[data-tv-region="detail-related"] [data-tv-focus="video:1"]').count();
    assert.equal(self, 0, "相关推荐不该包含当前作品");
    const target = page.locator('[data-tv-region="detail-related"] [data-tv-focus]').first();
    const key = await target.getAttribute("data-tv-focus");
    await target.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(expected => document.activeElement?.getAttribute("data-tv-focus")?.startsWith("detail:") && document.querySelector(`[data-tv-focus="detail:${expected}:play"]`), key, { timeout: 8000 });
    const heading = await page.locator(".tv-detail h1").textContent();
    assert.ok(!!heading, "点开相关推荐后应渲染新详情");
    return { relatedItems: items, opened: key };
  });
  await scenario("actual-worker-initials-resume-errors", async () => {
    const { page } = await open();
    await activate(page, "nav-search");
    /* 搜索页只留搜索本身，目录/同步状态改在设置页展示，这里轮询状态对象 */
    let status;
    for (let attempt = 0; attempt < 60; attempt++) {
      status = await catalogStatus(page).catch(() => undefined);
      if (status?.complete) break;
      await page.waitForTimeout(250);
    }
    assert.equal(status?.count, 12); assert.equal(status?.complete, true);
    const matches = await page.evaluate(async () => {
      const { queryCatalog } = await import("/src/tv/search/catalog.ts");
      const p = { blockedTags: [], paused: false, hideUntagged: false }, result = {};
      for (const query of ["WDSJ", "wdsj", "DSJ", "wdai sj2", "W-D_S.J"]) result[query] = (await queryCatalog(window.__tvFixture.base, query, 0, p)).items.map(item => `${item.kind}:${item.id}`);
      return result;
    });
    assert.deepEqual(matches.WDSJ, matches.wdsj); assert.deepEqual(matches.WDSJ, matches["W-D_S.J"]);
    assert.deepEqual(matches.WDSJ.slice(0, 3), ["video:1", "video:4", "video:2"]); assert(matches.DSJ.includes("video:1")); assert.deepEqual(matches["wdai sj2"], ["video:5"]);
    await activate(page, "search:field");
    for (const key of "WDSJ") await activate(page, `search:key:${key}`);
    await page.waitForTimeout(350); assert.equal(await activeKey(page), "search:key:J");
    await page.waitForFunction(() => document.querySelector(".tv-search-field")?.textContent === "WDSJ");
    await page.locator('[data-tv-focus="search:video:1"]').waitFor();
    await screenshot(page, "search-1280x720.png");
    assert.equal((await calls(page, "api_search")).length, 0); assert((await page.evaluate(() => window.__tvFixture.postMax)) <= 2);
    await page.evaluate(async () => { window.__tvFixture.catalogMode = "repeat"; await (await import("/src/tv/search/catalog.ts")).retryCatalog(window.__tvFixture.base, true); });
    let failed;
    for (let attempt = 0; attempt < 40; attempt++) {
      failed = await catalogStatus(page).catch(() => undefined);
      if (failed && failed.complete === false) break;
      await page.waitForTimeout(250);
    }
    assert.equal(failed?.complete, false); assert.equal(failed?.channels[0].nextPage, 2);
    assert.equal(await page.locator('[data-tv-focus="search:video:1"]').count(), 1, "Sync errors retain old matches");
    await page.evaluate(async () => { window.__tvFixture.catalogMode = "normal"; await (await import("/src/tv/search/catalog.ts")).retryCatalog(window.__tvFixture.base, true); });
    let recovered;
    for (let attempt = 0; attempt < 60; attempt++) {
      recovered = await catalogStatus(page).catch(() => undefined);
      if (recovered?.complete) break;
      await page.waitForTimeout(250);
    }
    assert.equal(recovered?.complete, true);
    return { matches, checkpoint: status, repeatedPageStopped: true, maxPostConcurrency: await page.evaluate(() => window.__tvFixture.postMax) };
  });
  await scenario("post-qualification-retry-source-discard", async () => {
    const { page } = await open({ isolated: true });
    const result = await page.evaluate(async () => {
      const { qualifyVisiblePosts } = await import("/src/tv/postEligibility.ts");
      const items = window.__tvFixture.posts.map(post => ({ ...post, kind: "post" }));
      window.__tvFixture.failPostIds = [1];
      const first = await qualifyVisiblePosts(items, { source: window.__tvFixture.base, isCurrent: () => true, allowed: item => item.id !== 6 });
      window.__tvFixture.failPostIds = [];
      const retry = await qualifyVisiblePosts([items[0]], { source: window.__tvFixture.base, isCurrent: () => true, allowed: () => true }, true);
      let current = true;
      const pending = qualifyVisiblePosts(items, { source: window.__tvFixture.base, isCurrent: () => current, allowed: () => true }, true);
      current = false;
      const stale = await pending;
      return { first: { items: first.items.map(item => item.id), retryable: first.retryable }, retry: retry.items.map(item => item.id), stale: stale.items,
        calls: window.__tvFixture.calls.filter(call => call.command === "api_post_playback").map(call => call.args.id), max: window.__tvFixture.postMax };
    });
    assert.deepEqual(result.first, { items: [2, 3, 4, 5], retryable: 1 }); assert.deepEqual(result.retry, [1]); assert.deepEqual(result.stale, []);
    assert(!result.calls.includes(6), "Blocked tags must prevent even eligibility parsing"); assert(result.max <= 2);
    return result;
  });
  await scenario("library-atomic-migration", async () => {
    const { page } = await open({ isolated: true });
    return page.evaluate(async () => (await import("/tests/tv-library.ts")).runTvLibraryTests());
  });
  /* 无头 Chromium 没有 H.264 解码器（Ubuntu CI/容器都没有），这个场景要等
     video.currentTime > .1，必然超时。打真机的才需要跑它。 */
  if (process.env.TV_REMOTE_SKIP_PLAYER === "1") {
    report.cases.push({ name: "player-remote-seek-last-part", status: "skipped" });
    console.log("SKIP TV player-remote-seek-last-part（无头环境没有视频解码器）");
  } else await scenario("player-remote-seek-last-part", async () => {
    const { page } = await open();
    await page.locator('[data-tv-region="home-推荐"] [data-tv-focus="video:1"]').waitFor();
    await page.locator('[data-tv-region="home-推荐"] [data-tv-focus="video:1"]').focus(); await page.keyboard.press("Enter");
    await activate(page, "detail:video:1:part:2");
    await page.waitForFunction(() => document.querySelector("video")?.currentTime > .1);
    await page.waitForFunction(() => document.querySelector(".tv-player-controls")?.hidden === true, null, { timeout: 10000 });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector(".tv-player-controls")?.hidden === false && document.activeElement?.getAttribute("data-tv-focus") === "player:play");
    await screenshot(page, "player-1280x720.png");
    assert.equal(await page.locator("video").evaluate(video => video.paused), false, "First confirm reveals without toggling");
    await page.keyboard.press("Enter"); await page.waitForFunction(() => document.querySelector("video")?.paused);
    await activate(page, "player:progress");
    const before = await page.locator("video").evaluate(video => video.currentTime);
    await page.keyboard.press("ArrowRight");
    assert(Math.abs(await page.locator("video").evaluate(video => video.currentTime) - before) < .5, "Seek preview must not commit");
    await page.keyboard.press("Escape"); assert.equal(await page.locator(".tv-player-seek-hint").count(), 0);
    await page.waitForTimeout(200);
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter");
    await page.waitForFunction(before => document.querySelector("video").currentTime >= before + 9, before);
    await page.locator("video").evaluate(video => { video.currentTime = video.duration - 1; });
    // Playwright's physical-key table omits some Android media keys; dispatch
    // the same DOM key the native remote emits through the real controller.
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "MediaPlay", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "MediaPlay", bubbles: true }));
    });
    await page.getByRole("dialog", { name: /播放完毕/ }).waitFor();
    assert.equal(await page.locator('[data-tv-focus="player:ended-next"]').count(), 0);
    assert((await calls(page, "api_play")).every(call => call.args.id === 1 && call.args.ep === 2));
    return { confirmTwoStages: true, previewCancelCommit: true, finalPartNoOtherWork: true };
  });
  await scenario("720p-1080p-4k-layout", async () => {
    const { page } = await open(); const measurements = [];
    await page.locator('[data-tv-region="home-推荐"] .tv-card').first().waitFor();
    for (const [width, height] of [[1280, 720], [1920, 1080], [3840, 2160]]) {
      await page.setViewportSize({ width, height });
      const card = page.locator('[data-tv-region="home-推荐"] .tv-card').first(); await card.focus();
      // 首页有 Hero 时第一行卡会超出下沿，真实遥控路径由 focusElement 滚到中段，
      // 这里模拟同样的滚动，否则测的是「未滚动的初始位置」而不是可用性
      await card.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest" }));
      const size = await card.evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom,
        text: parseFloat(getComputedStyle(element.querySelector("strong")).fontSize), helper: parseFloat(getComputedStyle(element.querySelector("small")).fontSize), outline: getComputedStyle(element).outlineStyle }; });
      assert(size.text >= 13.5 * width / 960 - .1); assert(size.helper >= 12 * width / 960 - .1); assert.equal(size.outline, "solid");
      assert(size.x >= 0 && size.right <= width && size.y >= 0 && size.bottom <= height);
      const file = `home-${width}x${height}.png`; await page.screenshot({ path: join(output, file), animations: "disabled" }); report.screenshots.push(file); measurements.push({ width, height, ...size });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await activate(page, "nav-settings");
    await page.locator('[data-tv-focus="autoplay-next"]').waitFor();
    await screenshot(page, "settings-1280x720.png");
    return measurements;
  });
  await scenario("standard-build-excludes-tv-resources", async () => {
    await vite.close(); vite = undefined;
    process.env.VITE_APP_EDITION = "standard";
    const modules = new Set();
    const result = await build({ root, logLevel: "warn", plugins: [{ name: "capture-standard-module-graph", generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) if (file.type === "chunk") for (const id of Object.keys(file.modules)) modules.add(id);
    } }], build: { write: false } });
    const forbidden = [...modules].filter(id => /\/src\/tv\/|\/pinyin-pro\//.test(id));
    assert.deepEqual(forbidden, [], "Standard app bundle must not contain TV modules or pinyin-pro");
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output || []);
    const css = outputs.filter(item => item.type === "asset" && item.fileName.endsWith(".css")).map(item => String(item.source)).join("\n");
    assert(!css.includes(".tv-search-keyboard"));
    return { modules: modules.size, forbidden, emitted: outputs.map(item => item.fileName) };
  });
  for (const context of contexts) for (const page of context.pages()) {
    assert.deepEqual(await page.evaluate(() => window.__tvFixture?.unknown || []), [], "Unexpected mock IPC is a hard failure");
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.external, []);
} catch (error) {
  report.error = String(error.stack || error); console.error(report.error); process.exitCode = 1;
} finally {
  for (const [index, context] of contexts.entries()) { await context.tracing.stop({ path: join(output, `trace-${index}.zip`) }).catch(() => {}); await context.close(); }
  await browser?.close(); await vite?.close();
  if (mediaDirectory) await rm(mediaDirectory, { recursive: true, force: true });
  if (savedEdition === undefined) delete process.env.VITE_APP_EDITION; else process.env.VITE_APP_EDITION = savedEdition;
  report.passed = report.cases.filter(item => item.status === "passed").length;
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`TV remote acceptance: ${report.passed}/${report.cases.length} scenarios. Artifacts: ${output}`);
}
