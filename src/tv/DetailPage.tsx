import { useEffect, useRef, useState } from "react";
import { api, cover } from "../api";
import { useContentPreferences } from "../contentPreferences";
import type { Detail } from "../types";
import type { TvContent, TvProgress } from "./model";
import { contentKey } from "./model";
import { focusElement, useRemoteScope } from "./remote";
import { TvAmbient, TvCard, TvModal } from "./ui";
import { videoCard } from "./catalogCards";
import { detailContent, failureMessage, postParts, videoParts, type TvPart } from "./player/content";
import "./player/player.css";

type Props = {
  content: TvContent;
  sourceKey: string;
  progress?: TvProgress;
  favorite: boolean;
  onFavorite: (content: TvContent) => void | Promise<void>;
  onPlay: (content: TvContent, part: string, resumeSeconds?: number) => void;
  onBack: () => void;
  onOpen: (content: TvContent) => void;
  onMetadata?: (content: TvContent) => void;
};

type Loaded = { request: string; content: TvContent; parts: TvPart[] };

export default function DetailPage({ content, sourceKey, progress, favorite, onFavorite, onPlay, onBack, onOpen, onMetadata }: Props) {
  const preferences = useContentPreferences();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [related, setRelated] = useState<TvContent[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [more, setMore] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [favoritePending, setFavoritePending] = useState(false);
  const transportEpoch = useRef(0);
  const key = `${content.kind}:${content.id}`;
  const sourceReady = !!sourceKey.split("@")[0];
  const request = `${sourceKey}:${key}:${preferences.revision}:${retry}`;
  const latest = useRef({ request, onMetadata }); latest.current = { request, onMetadata };
  const displayed = sourceReady && loaded?.request === request ? loaded : null;
  const item = displayed?.content ?? { ...content, title: "正在读取当前来源…", cover: "", description: undefined, score: undefined };
  const blocked = preferences.blockReason(item.tags);

  useEffect(() => {
    const changed = () => { transportEpoch.current++; setLoaded(null); setMore(false); };
    window.addEventListener("hg:line-changed", changed);
    window.addEventListener("hg:proxy-changed", changed);
    return () => { window.removeEventListener("hg:line-changed", changed); window.removeEventListener("hg:proxy-changed", changed); };
  }, []);

  useEffect(() => {
    let alive = true;
    const transport = transportEpoch.current;
    setError("");
    const current = () => alive && latest.current.request === request && transport === transportEpoch.current;
    if (!sourceReady || preferences.blockReason(content.tags)) return;
    void (async () => {
      const value = content.kind === "video" ? await api.video(content.id) : await api.post(content.id);
      if (!current()) return;
      if (value.id !== content.id) throw new Error("详情信息已变化，请重试");
      const resolved = detailContent(content, value);
      latest.current.onMetadata?.(resolved);
      if (preferences.blockReason(resolved.tags)) {
        setLoaded({ request, content: resolved, parts: [] }); return;
      }
      if (content.kind === "video") {
        setLoaded({ request, content: resolved, parts: videoParts(value as Detail) });
      } else {
        // Resolve segment identities only. The URLs stay in this request and are never saved.
        const playback = await api.postPlayback(content.id);
        if (!current() || preferences.blockReason(resolved.tags)) return;
        const parts = postParts(playback.videos);
        if (!parts.length) throw new Error("暂未确认可播放的视频分段，请重试");
        setLoaded({ request, content: resolved, parts });
      }
    })().catch(cause => { if (current()) setError(failureMessage(cause, "详情加载失败，请重试")); });
    return () => { alive = false; };
  }, [request]);

  useEffect(() => { setMore(false); setSelectedTags([]); }, [key, sourceKey, preferences.revision]);
  /* 相关推荐：详情打开后再拉，别跟主详情的请求抢带宽。失败静默——推荐是锦上添花，
     不该因为它的接口挂了就让整个详情页报错。
     useContentPreferences() 每次渲染都返回新对象，不能进依赖数组，否则会反复请求。 */
  const prefRef = useRef(preferences); prefRef.current = preferences;
  useEffect(() => {
    setRelated([]);
    if (content.kind !== "video" || !displayed) return;
    let alive = true;
    void api.related(content.id).then(result => {
      if (!alive) return;
      setRelated((result?.items || []).map(videoCard)
        .filter(item => item.id !== content.id && !prefRef.current.blockReason(item.tags))
        .slice(0, 12));
    }).catch(() => {});
    return () => { alive = false; };
  }, [content.id, content.kind, displayed]);
  useRemoteScope({ id: `detail:${key}`, priority: 20, onKey: remote => {
    if (remote === "back") { onBack(); return true; }
    return false;
  } });

  const parts = displayed?.parts ?? [];
  const resumable = progress?.key === key && parts.some(part => part.id === progress.part);
  const firstPart = resumable ? progress!.part : parts[0]?.id;
  /* 详情是异步拉回来的：挂载那一瞬间 parts 还是空数组，播放按钮 disabled，
     focusables() 的 :not(:disabled) 把它过滤掉，restoreFocus 就拿不到
     data-tv-initial，初始焦点掉到「返回列表」上。数据到达后如果不主动抢回来，
     遥控器用户从「返回列表」按「下」会直接落到选集区，四个操作按钮永远够不着。
     只在焦点还停在返回列表时抢；用户已经自己移走就不动。 */
  const claimed = useRef("");
  useEffect(() => {
    if (!firstPart || claimed.current === key) return;
    claimed.current = key;
    if (document.activeElement?.getAttribute("data-tv-focus") === `detail:${key}:back`)
      focusElement(document.querySelector<HTMLButtonElement>(".tv-detail-actions .tv-primary"));
  }, [firstPart, key]);
  const toggleFavorite = async () => {
    if (!displayed || favoritePending) return;
    setFavoritePending(true);
    try { await onFavorite(item); }
    catch (cause) { setError(failureMessage(cause, "收藏保存失败，请重试")); }
    finally { setFavoritePending(false); }
  };

  return <section className="tv-detail" aria-label="作品详情">
    <TvAmbient src={item.cover} />
    <div data-tv-region="detail-back"><button data-tv-focus={`detail:${key}:back`} onClick={onBack}>返回列表</button></div>
    {blocked ? <div className="tv-detail-message" role="status"><h1>内容已屏蔽</h1><p>{blocked}</p><p>你可以在设置中调整标签偏好。</p></div> : <>
      <div className="tv-detail-hero">
        <div className={`tv-detail-cover ${content.kind === "post" ? "tv-detail-cover-wide" : ""}`}>
          {displayed && item.cover ? <img src={cover(item.cover)} alt={`${item.title}封面`} /> : <span>HGhubTV</span>}
        </div>
        <div className="tv-detail-copy">
          <p className="tv-detail-eyebrow">{content.kind === "post" ? "吃瓜视频" : "影院片库"}</p>
          <h1>{item.title}</h1>
          <p className="tv-detail-meta">{item.score ? `${item.score.toFixed(1)} 分 · ` : ""}{parts.length ? `${parts.length} ${content.kind === "post" ? "个视频分段" : "集"}` : displayed ? "暂无可播放剧集" : "正在读取详情"}</p>
          {item.description && <p className="tv-detail-description">{item.description}</p>}
          <div className="tv-detail-tags" aria-label="标签">{displayed?.content.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
          <div className="tv-detail-actions" data-tv-region="detail-actions">
            <button data-tv-focus={`detail:${key}:play`} data-tv-initial className="tv-primary" disabled={!firstPart} onClick={() => firstPart && onPlay(item, firstPart, resumable ? progress!.seconds : 0)}>{resumable && progress!.seconds > 0 ? "继续观看" : "播放"}</button>
            <button data-tv-focus={`detail:${key}:favorite`} aria-pressed={favorite} disabled={!displayed || favoritePending} onClick={() => void toggleFavorite()}>{favorite ? "取消收藏" : "收藏"}</button>
            <button data-tv-focus={`detail:${key}:episodes`} disabled={!parts.length} onClick={() => focusElement(document.querySelector<HTMLButtonElement>(".tv-detail-episodes [data-tv-focus]"))}>{content.kind === "post" ? "选择分段" : "选集"}</button>
            <button data-tv-focus={`detail:${key}:more`} disabled={!displayed || !item.tags.length} onClick={() => { setSelectedTags([]); setMore(true); }}>更多</button>
          </div>
        </div>
      </div>
      {error ? <div className="tv-detail-message" role="alert"><p>{error}</p><div data-tv-region="detail-retry"><button data-tv-focus={`detail:${key}:retry`} onClick={() => setRetry(value => value + 1)}>重试</button></div></div> : !displayed ? <p role="status">正在加载详情…</p> : null}
      {!!parts.length && <div className="tv-detail-episodes"><h2>{content.kind === "post" ? "视频分段" : "剧集"}</h2><div className="tv-detail-episode-grid" data-tv-region="detail-episodes" data-tv-columns="8">
        {parts.map(part => {
          const isCurrent = resumable && progress!.part === part.id;
          return <button key={part.id} data-tv-focus={`detail:${key}:part:${part.id}`} aria-pressed={isCurrent} aria-label={`${content.kind === "post" ? "分段" : "第"} ${part.label}${content.kind === "post" ? "" : " 集"}${isCurrent ? "（上次观看）" : ""}`} onClick={() => onPlay(item, part.id, progress?.key === key && progress.part === part.id ? progress.seconds : 0)}>{part.label}</button>;
        })}
      </div></div>}
      {/* 相关推荐放在选集区下方：遥控器从剧集网格继续按「下」就能落到这里。 */}
      {!!related.length && <section className="tv-detail-related">
        <h2>相关推荐</h2>
        <div className="tv-detail-related-track" data-tv-region="detail-related" data-tv-columns={related.length}>
          {related.map(entry => <TvCard key={contentKey(entry)} content={entry} onOpen={onOpen} />)}
        </div>
      </section>}
    </>}
    {more && !blocked && <TvModal id={`detail-tags:${key}`} title="屏蔽标签" onClose={() => setMore(false)}>
      <p>选择当前作品的标签。屏蔽后，相关内容会立即隐藏。</p>
      <div data-tv-region="detail-tag-options" data-tv-columns="3" className="tv-detail-tag-grid">{item.tags.map(tag => <button key={tag} data-tv-focus={`block:${tag}`} aria-pressed={selectedTags.includes(tag)} onClick={() => setSelectedTags(previous => previous.includes(tag) ? previous.filter(value => value !== tag) : [...previous, tag])}>{selectedTags.includes(tag) ? "已选 · " : ""}{tag}</button>)}</div>
      <div data-tv-region="detail-tag-confirm"><button data-tv-focus="block-confirm" disabled={!selectedTags.length} onClick={() => { preferences.blockTags(selectedTags); setMore(false); }}>屏蔽所选标签</button><button data-tv-focus="block-cancel" onClick={() => setMore(false)}>取消</button></div>
    </TvModal>}
  </section>;
}
