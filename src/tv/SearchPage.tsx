import { useCallback, useEffect, useRef, useState } from "react";
import { api, cover } from "../api";
import { blockReason, useContentPreferences } from "../contentPreferences";
import { contentKey, type TvContent } from "./model";
import { qualifyVisiblePosts } from "./postEligibility";
import { queryCatalog, retryCatalog, startCatalog, useCatalogStatus } from "./search/catalog";
import { focusElement, useRemoteScope } from "./remote";
import { TvAmbient } from "./ui";
import "./search/search.css";

/* 三行各 10 个：遥控器上下键按 data-tv-columns=10 算落点，某行少一个就会串位
   （实测第二行只有 9 个时，第三行的 Z 被 grid 自动排到第二行末尾）。 */
const KEYPAD: (string | { key: string; action: string })[][] = [
  "QWERTYUIOP".split(""),
  [..."ASDFGHJKL".split(""), { key: "删除", action: "delete" }],
  [..."ZXCVBNM".split(""), { key: "空格", action: "space" }, { key: "清空", action: "clear" }, { key: "完成", action: "done" }],
];
const HISTORY_KEY = "hghubtv_search_history";
type Results = { identity: string; items: TvContent[]; offset: number; hasMore: boolean; total: number; retryable: number; loading: boolean; error: string };
const initial = (identity: string): Results => ({ identity, items: [], offset: 0, hasMore: false, total: 0, retryable: 0, loading: false, error: "" });

function readHistory(): string[] {
  try { const raw = localStorage.getItem(HISTORY_KEY); const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) ? list.filter(v => typeof v === "string").slice(0, 6) : []; }
  catch { return []; }
}
function saveHistory(list: string[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 6))); } catch { /* 隐私模式下写不进去，忽略 */ }
}

export default function SearchPage({ source, paused, onOpen }: { source: string; paused: boolean; onOpen: (content: TvContent) => void }) {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [typing, setTyping] = useState(false);
  const [hot, setHot] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>(readHistory);
  const preferences = useContentPreferences();
  const status = useCatalogStatus(source);
  const inputRef = useRef<HTMLButtonElement>(null);
  const identity = `${source}|${term}|${preferences.revision}`;
  const [results, setResults] = useState<Results>(() => initial(identity));
  const state = useRef(results); state.current = results;
  const context = useRef({ identity, source, paused, preferences: preferences.preferences });
  context.current = { identity, source, paused, preferences: preferences.preferences };
  const sequence = useRef(0);
  const busy = useRef(false);
  const loadedCount = useRef(-1);
  const loadedIdentity = useRef("");

  useEffect(() => { if (source) startCatalog(source); }, [source]);
  /* 热词直接取热播榜标题：比写死一列营销词更贴近用户真正在搜的东西 */
  useEffect(() => {
    if (!source) return;
    let alive = true;
    void api.rank("hot").then(value => { if (alive) setHot(value.items.slice(0, 6).map(item => item.title).filter(Boolean)); }).catch(() => {});
    return () => { alive = false; };
  }, [source]);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query), 220);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (append = false, retry = false) => {
    if (busy.current || !source || paused) return;
    const token = ++sequence.current;
    const key = identity;
    const current = () => token === sequence.current && context.current.identity === key && !context.current.paused;
    const allowed = (content: TvContent) => !blockReason(content.tags, context.current.preferences);
    busy.current = true;
    const previous = append && state.current.identity === key ? state.current : initial(key);
    const retained = state.current.identity === key ? state.current : initial(key);
    setResults({ ...retained, loading: true, error: "" });
    let offset = previous.offset, found = [...previous.items], retryable = previous.retryable, hasMore = false, total = previous.total;
    try {
      // One current page plus at most two extra pages. The next step is explicit.
      for (let extra = 0; extra <= 2; extra++) {
        const page = await queryCatalog(source, term, offset, context.current.preferences);
        if (!current()) return;
        const eligible = await qualifyVisiblePosts(page.items, { source, isCurrent: current, allowed }, retry);
        if (!current()) return;
        const playable = new Set(eligible.items.map(contentKey));
        const seen = new Set(found.map(contentKey));
        found = [...found, ...page.items.filter(item => allowed(item) && (item.kind === "video" || playable.has(contentKey(item))) && !seen.has(contentKey(item)))];
        retryable += eligible.retryable;
        offset = page.nextOffset; hasMore = page.hasMore;
        /* 同一个查询串后端两次可能给出不同的总数字（实测 570 → 870）。总数只认
           第一次拿到的值，分页只追加不重算，否则屏幕上数字会自己跳。 */
        if (!total) total = page.total;
        if (found.length >= previous.items.length + 20 || !hasMore) break;
      }
      if (current()) {
        loadedIdentity.current = key;
        /* 精确片名置顶：后端按热度混排，搜「时停手表」正确结果会掉到第二位。
           Chrome 66 的 Array#sort 不保证稳定，所以显式带原序号兜底。 */
        const exact = term.trim();
        const ordered = found
          .map((item, index) => ({ item, index, rank: item.title.trim() === exact ? 0 : 1 }))
          .sort((a, b) => a.rank - b.rank || a.index - b.index)
          .map(entry => entry.item);
        setResults({ identity: key, items: ordered, offset, hasMore, total, retryable, loading: false, error: "" });
      }
    } catch (error) {
      if (current()) setResults({ ...retained, loading: false, error: error instanceof Error ? error.message : String(error) });
    } finally { if (token === sequence.current) busy.current = false; }
  }, [source, paused, identity, term]);

  useEffect(() => {
    sequence.current++; busy.current = false;
    if (paused) {
      setResults(previous => previous.loading ? { ...previous, loading: false } : previous);
      return;
    }
    if (state.current.identity !== identity) {
      loadedIdentity.current = "";
      setResults(initial(identity));
    } else if (loadedIdentity.current === identity) {
      return;
    }
    loadedCount.current = status.count;
    void load();
    return () => { sequence.current++; busy.current = false; };
  }, [load]);
  useEffect(() => {
    if (!status.initialized || busy.current || loadedCount.current === status.count) return;
    loadedCount.current = status.count;
    if (state.current.items.length > 20) return;
    // Metadata updates only replace results; they never move the keyboard focus.
    void load();
  }, [status.count, status.initialized, load]);

  const visible = results.identity === identity ? results : initial(identity);
  const closeKeypad = useCallback(() => {
    setTyping(false);
    window.requestAnimationFrame(() => focusElement(inputRef.current));
  }, []);
  useRemoteScope({
    id: "search-keypad",
    priority: 30,
    onKey: key => {
      if (!paused && typing && key === "back") { closeKeypad(); return true; }
      return false;
    },
  });
  const run = (value: string) => {
    setQuery(value);
    closeKeypad();
    if (value.trim()) {
      const next = [value, ...history.filter(item => item !== value)].slice(0, 6);
      setHistory(next); saveHistory(next);
    }
  };
  const type = (key: string) => setQuery(value => `${value}${key}`.slice(0, 24));
  const clearHistory = () => { setHistory([]); saveHistory([]); };

  return <section className="tv-search" aria-label="搜索"><TvAmbient src={results.items[0]?.cover} />
    <div className="tv-search-head" data-tv-region="search-input" data-tv-columns="2">
      <button ref={inputRef} className={`tv-search-field${query ? "" : " is-empty"}`} data-tv-focus="search:field"
        data-tv-initial onClick={() => setTyping(true)}>{query || "输入片名、演员或拼音首字母"}</button>
      <button className="tv-search-submit" data-tv-focus="search:submit" onClick={() => run(query)}>搜索</button>
    </div>

    <div className={`tv-search-body${typing ? " is-typing" : ""}`}>
    {typing && <div className="tv-search-keypad" data-tv-region="search-keyboard" data-tv-columns="10">
      {KEYPAD.flat().map(cell => {
        if (typeof cell === "string") return <button key={cell} data-tv-focus={`search:key:${cell}`} onClick={() => type(cell)}>{cell}</button>;
        const run2 = cell.action === "space" ? () => type(" ")
          : cell.action === "delete" ? () => setQuery(value => value.slice(0, -1))
          : cell.action === "clear" ? () => setQuery("")
          : () => run(query);
        return <button key={cell.action} className={`is-action${cell.action === "done" ? " is-done" : ""}`}
          data-tv-focus={`search:key:${cell.action}`} onClick={run2}>{cell.key}</button>;
      })}
    </div>}

    <div className="tv-search-detail">
    {!!hot.length && !query && <>
      <p className="tv-search-heading">热门搜索</p>
      <div className="tv-search-chips" data-tv-region="search-hot" data-tv-columns="3">
        {hot.map(title => <button key={title} data-tv-focus={`search:hot:${title}`} onClick={() => run(title)}>{title}</button>)}
      </div>
    </>}

    {!!history.length && !query && <>
      <p className="tv-search-heading">搜索历史<button className="tv-search-clear" data-tv-focus="search:clear-history" onClick={clearHistory}>清空</button></p>
      <div className="tv-search-chips" data-tv-region="search-history" data-tv-columns="3">
        {history.map(item => <button key={item} data-tv-focus={`search:history:${item}`} onClick={() => run(item)}>{item}</button>)}
      </div>
    </>}

    {query && <div className="tv-search-results">
      <p className="tv-search-heading">{visible.loading ? "正在搜索…" : `找到 ${visible.total || visible.items.length} 部`}
        {visible.hasMore && !visible.loading && <button className="tv-search-clear" data-tv-focus="search:load-more" onClick={() => void load(true)}>加载更多</button>}</p>
      {visible.error && <p role="alert" className="tv-search-error">{visible.error}<button data-tv-focus="search:retry-results" onClick={() => void load(false, true)}>重试</button></p>}
      <div className="tv-grid" data-tv-region="search-results" data-tv-columns={typing ? 3 : 5}>
        {visible.items.filter(item => !preferences.blockReason(item.tags)).map(item =>
          <button key={contentKey(item)} type="button" className={`tv-card ${item.kind === "post" ? "tv-card-wide" : ""}`}
            data-tv-focus={`search:${contentKey(item)}`} onClick={() => onOpen(item)}>
            <div className="tv-card-art">{item.cover ? <img src={cover(item.cover)} alt="" loading="lazy" decoding="async" /> : <span className="tv-neutral">HGhubTV</span>}
              {!!item.score && <span className="tv-score">{item.score.toFixed(1)}</span>}</div>
            <strong>{item.title}</strong><small>{item.kind === "post" ? "吃瓜视频" : item.episodeCount ? `${item.episodeCount} 集` : "查看详情"}</small>
          </button>)}
      </div>
      {!visible.loading && !visible.items.length && !visible.error && <p className="tv-search-empty">
        {status.complete ? "没有找到匹配的内容，换个词试试。" : "目录还在同步，稍后再试。"}
        <button data-tv-focus="search:retry-catalog" onClick={() => void retryCatalog(source)}>刷新目录</button></p>}
    </div>}
    </div>
    </div>
  </section>;
}
