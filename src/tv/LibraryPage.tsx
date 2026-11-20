import { useEffect, useState } from "react";
import { api } from "../api";
import type { TvContent } from "./model";
import { contentKey } from "./model";
import { rankCard } from "./catalogCards";
import { useTv } from "./TvProvider";
import { TvAmbient, TvCard, TvModal } from "./ui";

/** 片库：本地观看记录与收藏。
 *
 *  空的时候原来只有一行提示，整页几乎全空。补两件事：
 *  1. 空状态给两个可聚焦出口（去浏览 / 看热门），遥控器能直接跳走
 *  2. 库内不足 5 条时在下方挂一行「大家都在看」，复用首页的热榜接口
 *     超过 5 条就不挂了 —— 片库是「我的」空间，塞满官方推荐喧宾夺主。
 */
export default function LibraryPage({ onOpen, onNavigate }: {
  onOpen: (content: TvContent) => void;
  onNavigate?: (tab: "home" | "browse", keepNavFocus?: boolean) => void;
}) {
  const { library, clearHistory } = useTv();
  const [tab, setTab] = useState("watching");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [hot, setHot] = useState<TvContent[]>([]);

  const items = library.filter(item => tab === "favorites" ? item.favorite : !!item.progress)
    .sort((a, b) => (b.progress?.updatedAt || 0) - (a.progress?.updatedAt || 0));
  const watching = library.filter(item => item.progress).length;
  const saved = library.filter(item => item.favorite).length;
  const done = library.filter(item => item.progress && item.progress.seconds >= 60).length;

  // 库空或很薄时才需要保底内容；有数据时这个请求也照发，但渲染条件会跳过
  useEffect(() => {
    let alive = true;
    void api.rank("hot").then(value => {
      if (alive) setHot(value.items.slice(0, 12).map(rankCard));
    }).catch(() => { /* 拉不到就不挂推荐，不影响片库本身 */ });
    return () => { alive = false; };
  }, []);

  const showHot = library.length < 5 && hot.length > 0;

  return <>
    <TvAmbient src={items[0]?.content.cover} />
    <header className="tv-page-heading"><h1>我的片库</h1>
      {/* 统计做成一行胶囊：三张大卡会抢掉「继续观看」的视觉权重 */}
      <div className="tv-lib-stats">
        <span><b>{watching}</b> 追剧中</span><span><b>{done}</b> 看过的</span><span><b>{saved}</b> 收藏</span>
      </div></header>
    <div className="tv-tabs" data-tv-region="library-tabs">
      <button data-tv-focus="watching" data-tv-initial aria-pressed={tab === "watching"} onClick={() => setTab("watching")}>继续观看</button>
      <button data-tv-focus="favorites" aria-pressed={tab === "favorites"} onClick={() => setTab("favorites")}>我的收藏</button>
      {tab === "watching" && items.length > 0 && <button data-tv-focus="clear-history" onClick={() => setConfirm(true)}>清空记录</button>}
    </div>
    <div className="tv-grid" data-tv-region="library-grid" data-tv-columns="5">{items.map(item => <div key={item.key}><TvCard content={item.content} onOpen={onOpen} placeholder wide={tab === "watching"} progress={item.progress} />{tab === "watching" && item.progress && <small>第 {item.progress.part} {item.content.kind === "post" ? "段" : "集"}{item.progress.duration > 0 ? ` · 还剩 ${Math.max(1, Math.round((item.progress.duration - item.progress.seconds) / 60))} 分钟` : item.progress.seconds >= 60 ? ` · 已看 ${Math.round(item.progress.seconds / 60)} 分钟` : ""}</small>}</div>)}</div>

    {!items.length && <div className="tv-lib-empty">
      <p className="tv-status">{tab === "favorites" ? "还没有收藏，进入详情页即可收藏作品。" : "看过之后，进度会记在这里。"}</p>
      <div className="tv-lib-empty-actions" data-tv-region="library-empty" data-tv-columns="2">
        <button data-tv-focus="lib-go-browse" onClick={() => onNavigate?.("browse", false)}>去浏览</button>
        <button data-tv-focus="lib-go-home" onClick={() => onNavigate?.("home", false)}>看热门</button>
      </div>
    </div>}

    {showHot && <section className="tv-shelf tv-lib-hot">
      <h2>大家都在看</h2>
      <div className="tv-shelf-track" data-tv-region="library-hot" data-tv-scroll-id="library-hot">
        {hot.map(content => <TvCard key={contentKey(content)} content={content} onOpen={onOpen} />)}
      </div>
    </section>}

    {confirm && <TvModal id="clear-history" title="清空本机观看历史？" onClose={() => setConfirm(false)}><p>收藏将保留，已迁移的旧历史不会重新导入。</p>{error && <p role="alert">{error}</p>}<button data-tv-focus="confirm-clear-history" onClick={() => void clearHistory().then(() => setConfirm(false)).catch(e => setError(String(e)))}>确认清空</button></TvModal>}
  </>;
}
