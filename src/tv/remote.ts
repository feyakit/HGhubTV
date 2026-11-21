import { useLayoutEffect, useRef } from "react";
import { addPluginListener } from "@tauri-apps/api/core";

export type RemoteKey = "up" | "down" | "left" | "right" | "confirm" | "back" | "playPause" | "play" | "pause" | "next" | "previous";
type Scope = { id: string; priority?: number; onKey: (key: RemoteKey) => boolean | void };
const scopes: Scope[] = [];
let installed = false, lastBack = -Infinity;
const selector = '[data-tv-focus]:not(:disabled), .hg-agreement button:not(:disabled)';
const visible = (element: HTMLElement | null) => !!element && !element.closest('[hidden], [aria-hidden="true"], [inert]') && element.getClientRects().length > 0;
export function focusables(root: ParentNode = document): HTMLElement[] { return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(visible); }
function surface(): HTMLElement | Document { return Array.from(document.querySelectorAll<HTMLElement>('[data-tv-modal]')).filter(visible).pop() || document; }
export function focusElement(element?: HTMLElement | null) {
  if (!element || !visible(element)) return;
  element.focus({ preventScroll: true });
  /* 客厅电视上焦点行应该滚到屏幕中段：nearest 只在「完全不可见」时才滚动，
     首页有 Hero 时第一行卡片刚好卡在下沿，聚焦放大后底部会被切掉。 */
  element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
}
export function registerRemoteScope(scope: Scope) { scopes.push(scope); return () => { const index = scopes.indexOf(scope); if (index >= 0) scopes.splice(index, 1); }; }
export function useRemoteScope(scope: Scope) {
  const ref = useRef(scope); ref.current = scope;
  useLayoutEffect(() => registerRemoteScope({ id: scope.id, priority: scope.priority, onKey: key => ref.current.onKey(key) }), [scope.id, scope.priority]);
}
export const registerStartupBack = (handler: () => void) => registerRemoteScope({ id: "startup", priority: 1000, onKey: key => { if (key === "back") { handler(); return true; } } });

// Explicit region/grid coordinates decide within rows; geometry is used only to
// choose between regions, never to reorder cards in a row or a five-column grid.
function navigate(key: RemoteKey) {
  const root = surface(), all = focusables(root);
  let active = document.activeElement as HTMLElement;
  /* 焦点元素刚被重新渲染踢掉（异步数据到达时很常见：按钮先 disabled 再 enabled）。
     这时不能盲跳 DOM 顺序第一个——详情页第一个是「返回列表」，会把用户送到页面
     顶部，四个操作按钮反而更远了。优先回到声明了 data-tv-initial 的主操作上。 */
  if (!all.includes(active)) { focusElement(all.find(el => el.hasAttribute("data-tv-initial")) || all[0]); return; }
  if (key === "confirm") { active.click(); return; }
  if (!["up", "down", "left", "right"].includes(key)) return;
  if (active.hasAttribute("data-tv-scroll") && (key === "up" || key === "down")) {
    const next = active.scrollTop + (key === "down" ? 1 : -1) * active.clientHeight * .6;
    if (key === "up" && active.scrollTop > 0 || key === "down" && active.scrollTop + active.clientHeight < active.scrollHeight - 2) { active.scrollTop = next; return; }
  }
  const region = active.closest<HTMLElement>('[data-tv-region]');
  const peers = region ? focusables(region).filter(item => item.closest('[data-tv-region]') === region) : [];
  const index = peers.indexOf(active), columns = Number(region?.dataset.tvColumns) || peers.length;
  let target = -1;
  if (index >= 0) {
    if (key === "left" && index % columns > 0) target = index - 1;
    if (key === "right" && index % columns < columns - 1 && index + 1 < peers.length) target = index + 1;
    if (key === "up" && index >= columns) target = index - columns;
    if (key === "down" && index + columns < peers.length) target = index + columns;
    /* 短行：按「下」要落到最后一行「同一列」。原来一律跳 peers.length-1，5 列网格
       里第 2 列按下去会跳到第 5 张，横向位置完全对不上。
       注意必须先判断「当前不在最后一行」——单行 region（比如详情页的四个操作按钮）
       里 lastRowStart 就是当前行，直接算会选中自己，焦点原地不动。 */
    if (key === "down" && target < 0 && index >= 0) {
      const currentRow = Math.floor(index / columns), lastRow = Math.floor((peers.length - 1) / columns);
      if (currentRow < lastRow) {
        const sameColumn = lastRow * columns + index % columns;
        target = sameColumn < peers.length ? sameColumn : peers.length - 1;
      }
    }
    // 一级导航是单列竖排：首尾要环绕，否则按到底就卡住（用户反馈的「上下不能循环」）。
    if (region?.dataset.tvRegion === "navigation" && columns === 1 && peers.length > 1) {
      if (key === "up" && index === 0) target = peers.length - 1;
      if (key === "down" && index === peers.length - 1) target = 0;
    }
  }
  if (target >= 0) { focusElement(peers[target]); return; }
  /* 几何兜底只在 region 之间选落点。原来 across*3 且不设上限，从右栏按「下」可能
     跳到屏幕另一头的左菜单。这里收紧三处：同侧跨度不超过视口 90%、横向偏移不超过
     视口宽 35%（竖向键）/ 视口高 50%（横向键）、权重降到 1.6。 */
  const a = active.getBoundingClientRect(), ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
  const horizontal = key === "left" || key === "right", sign = key === "left" || key === "up" ? -1 : 1;
  const viewW = window.innerWidth, viewH = window.innerHeight;
  const forwardLimit = (horizontal ? viewW : viewH) * .9;
  const acrossLimit = horizontal ? viewH * .5 : viewW * .35;
  const candidates = all.filter(item => item !== active && (!region || item.closest('[data-tv-region]') !== region)).map(item => {
    const b = item.getBoundingClientRect(), dx = (b.left + b.right) / 2 - ax, dy = (b.top + b.bottom) / 2 - ay;
    const forward = (horizontal ? dx : dy) * sign, across = Math.abs(horizontal ? dy : dx);
    return { item, forward, across, score: forward + across * 1.6 };
  }).filter(item => item.forward > 2 && item.forward < forwardLimit && item.across < acrossLimit)
    .sort((a, b) => a.score - b.score);
  focusElement(candidates[0]?.item);
}
function dispatch(key: RemoteKey) {
  pendingRestore = undefined; restoration++;
  if (key === "back") {
    const now = performance.now(), duplicate = now-lastBack<180;
    // A trailing gate suppresses a continuous native callback burst rather
    // than allowing one navigation every 180 ms throughout that burst.
    lastBack = now;
    if (duplicate) return;
  }
  const root = surface();
  const modal = root instanceof HTMLElement ? root.dataset.tvModal : undefined;
  // The topmost modal owns every key, including media keys. A player/page
  // handler must never execute beneath a dialog that only handles Back itself.
  const eligible = modal ? scopes.filter(scope => scope.id === modal || scope.id === "startup") : scopes;
  const ordered = eligible.map((scope,index)=>({scope,index})).sort((a,b)=>(b.scope.priority||0)-(a.scope.priority||0)||b.index-a.index);
  for (const {scope} of ordered) {
    if (scope.onKey(key) === true) return;
  }
  navigate(key);
}
const keys: Record<string, RemoteKey> = { ArrowUp:"up", ArrowDown:"down", ArrowLeft:"left", ArrowRight:"right", Enter:"confirm", " ":"confirm", Escape:"back", Backspace:"back", BrowserBack:"back", GoBack:"back", MediaPlayPause:"playPause", MediaPlay:"play", MediaPause:"pause", MediaTrackNext:"next", MediaTrackPrevious:"previous" };
const eventKey = (event: KeyboardEvent) => keys[event.key] || ({ 23:"confirm", 4:"back", 461:"back", 179:"playPause" } as Record<number, RemoteKey>)[event.keyCode];
/** Exactly one keyboard listener and one native back subscription per WebView. */
export function installRemoteController() {
  if (installed) return; installed = true;
  const pressed = new Set<RemoteKey>();
  const onePerPress = new Set<RemoteKey>(["confirm","back","playPause","play","pause","next","previous"]);
  let backReleased = -Infinity;
  window.addEventListener("keydown", event => {
    const key = eventKey(event);
    if (!key && event.key !== "Tab") return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === "Tab") {
      pendingRestore = undefined; restoration++;
      const all = focusables(surface()), index = all.indexOf(document.activeElement as HTMLElement);
      focusElement(all[(index + (event.shiftKey ? -1 : 1) + all.length) % all.length]); return;
    }
    if (onePerPress.has(key)) {
      if (event.repeat || pressed.has(key)) return;
      pressed.add(key);
    }
    dispatch(key);
  }, true);
  window.addEventListener("keyup", event => {
    const key = eventKey(event);
    if (!onePerPress.has(key)) return;
    pressed.delete(key);
    if (key === "back") backReleased = performance.now();
    // Suppress the browser's keyup Space/Enter activation after our keydown click.
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  window.addEventListener("blur", () => pressed.clear());
  document.addEventListener("visibilitychange", () => { if (document.hidden) pressed.clear(); });
  void addPluginListener("app", "back-button", () => {
    if (pressed.has("back") || performance.now()-backReleased<180) return;
    dispatch("back");
  }).catch(() => {});
  // Repair a removed/blocked focused card using its old region and ordinal.
  let last: { region: string; index: number } | null = null;
  document.addEventListener("focusin", event => {
    const element = event.target as HTMLElement, region = element.closest<HTMLElement>('[data-tv-region]');
    if (region) last = { region: region.dataset.tvRegion || "", index: focusables(region).indexOf(element) };
  });
  new MutationObserver(() => {
    if (applyPendingRestore()) return;
    if (visible(document.activeElement as HTMLElement) && focusables(surface()).includes(document.activeElement as HTMLElement)) return;
    const root = surface(), regions = Array.from(root.querySelectorAll<HTMLElement>('[data-tv-region]'));
    const region = regions.find(r => visible(r) && r.dataset.tvRegion === last?.region);
    const list = region ? focusables(region) : focusables(root);
    // A removed card keeps its ordinal only within that same region. A new
    // page/dialog starts at its own initial control, not the previous page's index.
    const ordinal = region ? Math.max(last?.index || 0,0) : 0;
    focusElement((!region && list.find(element=>element.hasAttribute("data-tv-initial"))) || list[Math.min(ordinal, list.length - 1)] || list[0]);
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "disabled", "aria-hidden", "inert"] });
}

type FocusMemory = { id?: string; region?: string; index: number; scroll: { id: string; top: number; left: number }[] };
const memories = new Map<string, FocusMemory>();
let pendingRestore: { page: string; saved: FocusMemory; until: number } | undefined;
export function rememberFocus(page: string) {
  const active = document.activeElement as HTMLElement, region = active.closest<HTMLElement>('[data-tv-region]');
  if (!visible(active) || !focusables(surface()).includes(active)) return;
  memories.set(page, { id: active.dataset.tvFocus, region: region?.dataset.tvRegion, index: region ? focusables(region).indexOf(active) : 0,
    scroll: Array.from(document.querySelectorAll<HTMLElement>('[data-tv-scroll-id]')).filter(visible).map(el => ({ id: el.dataset.tvScrollId!, top: el.scrollTop, left: el.scrollLeft })) });
}
function applyPendingRestore(): boolean {
  const pending = pendingRestore;
  if (!pending) return false;
  if (performance.now() > pending.until) { pendingRestore = undefined; return false; }
  const root = surface(), saved = pending.saved, all = focusables(root);
  const region = Array.from(root.querySelectorAll<HTMLElement>('[data-tv-region]')).find(el => visible(el) && el.dataset.tvRegion === saved.region);
  const peers = region ? focusables(region) : [];
  const exact = all.find(el => el.dataset.tvFocus === saved.id && (!saved.region || el.closest<HTMLElement>('[data-tv-region]')?.dataset.tvRegion === saved.region));
  const target = exact || peers[Math.min(Math.max(saved.index,0),peers.length-1)];
  if (!target) return false;
  for (const scroll of saved.scroll) { const el = Array.from(root.querySelectorAll<HTMLElement>('[data-tv-scroll-id]')).find(e => visible(e) && e.dataset.tvScrollId === scroll.id); if (el) { el.scrollTop = scroll.top; el.scrollLeft = scroll.left; } }
  pendingRestore = undefined;
  focusElement(target);
  return true;
}
let restoration = 0;
export function restoreFocus(page: string) {
  const generation = ++restoration;
  requestAnimationFrame(() => {
    if (generation !== restoration) return;
    const saved = memories.get(page), all = focusables(surface());
    const initial = all.find(el => el.hasAttribute("data-tv-initial"));
    /* 上次停在顶部导航时不要恢复：导航是工具条，一进页面焦点应该落在内容的主操作上。
       否则每次冷启动都从「首页」标签开始，按确认只是切 tab，用户以为播放坏了。 */
    const stale = !!saved && !!initial && saved.region === "navigation";
    pendingRestore = saved && !stale ? { page, saved, until: performance.now()+15_000 } : undefined;
    if (applyPendingRestore()) return;
    // Keep pending restoration while asynchronously mounted cards arrive, but
    // any subsequent user key cancels it so late data never steals focus.
    focusElement(initial || all.find(el=>!el.closest('nav')) || all[0]);
  });
}
