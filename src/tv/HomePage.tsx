import { useEffect, useRef, useState } from "react";
import { api, cover, fmtTime } from "../api";
import { useContentPreferences } from "../contentPreferences";
import { contentKey, type TvContent } from "./model";
import { rankCard, videoCard } from "./catalogCards";
import { indexMetadata } from "./search/catalog";
import { useTv } from "./TvProvider";
import { TvAmbient, TvCard, TvStatus } from "./ui";
export default function HomePage({ onOpen, onPlay, active = true }: { onOpen: (content: TvContent) => void; onPlay?: (content: TvContent, part?: string, seconds?: number) => void; active?: boolean }) {
  const { source, sourceKey, library } = useTv(), { blockReason, revision } = useContentPreferences();
  const [rows, setRows] = useState<{title:string;items:TvContent[]}[]>([]), [error,setError] = useState(""), [busy,setBusy] = useState(true), [retry,setRetry] = useState(0);
  const [ambientCover, setAmbientCover] = useState<string | undefined>(undefined);
  const fulfilled = useRef("");
  const identity = `${sourceKey}:${retry}:${revision}`;
  useEffect(() => {
    if (!active || !source || fulfilled.current === identity) return;
    let current = true; setBusy(true); setError(""); setRows([]);
    void (async () => {
      try {
        const [recRes, popRes, latRes] = await Promise.allSettled([
          api.feed(1, 15),
          api.rank("hot"),
          api.category("ai-duanju", 1, 15, "latest"),
        ]);
        if (!current) return;
        const next: { title: string; items: TvContent[] }[] = [];
        if (recRes.status === "fulfilled") next.push({ title: "推荐", items: recRes.value.items.map(videoCard) });
        if (popRes.status === "fulfilled") next.push({ title: "热门", items: popRes.value.items.slice(0, 15).map(rankCard) });
        if (latRes.status === "fulfilled") next.push({ title: "新更新", items: latRes.value.items.map(videoCard) });
        if (!next.length) {
          const reason = recRes.status === "rejected" ? recRes.reason : popRes.status === "rejected" ? popRes.reason : latRes.status === "rejected" ? latRes.reason : "加载失败";
          setError(String(reason));
          return;
        }
        fulfilled.current = identity; setRows(next); void indexMetadata(source, next.flatMap(row => row.items)).catch(() => {});
      } catch(e) { if(current) setError(String(e)); } finally { if(current) setBusy(false); }
    })(); return () => { current = false; };
  }, [sourceKey, source, retry, revision, active, identity]);
  const history = library.filter(entry => entry.progress).sort((a,b) => b.progress!.updatedAt - a.progress!.updatedAt);
  const resuming = history[0];
  const hero = resuming?.content ?? rows[0]?.items[0];
  const heroPart = resuming?.progress?.part ?? "";
  const heroSeconds = resuming?.progress?.seconds ?? 0;
  const heroDuration = resuming?.progress?.duration ?? 0;
  const [heroDesc, setHeroDesc] = useState("");
  const heroPlay = useRef<HTMLButtonElement>(null);
  const claimedHeroFocus = useRef(false);
  useEffect(() => {
    if (!hero || !active) return;
    const take = () => {
      if (document.documentElement.dataset.tvNavHold) return;
      const current = document.activeElement as HTMLElement | null;
      const onDefaultNav = !claimedHeroFocus.current && current?.getAttribute?.("data-tv-focus") === "nav-home";
      const idle = !current || current === document.body || current === document.documentElement || onDefaultNav;
      if (idle) {
        claimedHeroFocus.current = true;
        heroPlay.current?.focus({ preventScroll: true });
      }
    };
    const timer = window.setTimeout(take, 60);
    return () => { window.clearTimeout(timer); };
  }, [hero?.kind, hero?.id, active]);
  useEffect(() => {
    setHeroDesc("");
    if (!hero || !source) return;
    let alive = true;
    const request = hero.kind === "post" ? api.post(hero.id) : api.video(hero.id);
    void request.then((detail) => {
      if (!alive) return;
      const text = (detail as { description?: string; desc?: string })?.description ?? (detail as { desc?: string })?.desc ?? "";
      setHeroDesc(String(text));
    }).catch(() => {});
    return () => { alive = false; };
  }, [hero?.kind, hero?.id, source]);
  const heroMeta = hero ? [hero.score ? `${hero.score.toFixed(1)} 分` : "", hero.episodeCount ? `${hero.episodeCount} 集` : "", hero.kind === "post" ? "吃瓜视频" : "短剧"].filter(Boolean).join("  |  ") : "";
  const activeAmbient = ambientCover || hero?.cover;
  return <>
    <TvAmbient src={activeAmbient} />
    {hero && <header className="tv-hero" data-tv-region="home-hero" aria-label="精选推荐" onFocus={() => setAmbientCover(undefined)}>
      <div className="tv-hero-body">
        {resuming && <p className="tv-hero-kicker">接着看</p>}
        <h1 className="tv-hero-title">{hero.title}</h1>
        {heroMeta && <p className="tv-hero-meta">{heroMeta}</p>}
        {heroDesc && <p className="tv-hero-desc">{heroDesc}</p>}
        <div className="tv-hero-actions" data-tv-region="home-hero-actions">
          {resuming ? <>
            <button ref={heroPlay} className="tv-hero-primary" data-tv-focus="hero-play" data-tv-initial
              onClick={() => (onPlay ?? onOpen)(hero, heroPart || "1", heroSeconds)}>▶ 继续观看 · 第 {heroPart} 集</button>
            <button className="tv-hero-secondary" data-tv-focus="hero-restart"
              onClick={() => (onPlay ?? onOpen)(hero, "1", 0)}>从第 1 集开始</button>
          </> : <>
            <button ref={heroPlay} className="tv-hero-primary" data-tv-focus="hero-play" data-tv-initial
              onClick={() => (onPlay ?? onOpen)(hero)}>▶ 播放</button>
          </>}
          <button className="tv-hero-ghost" data-tv-focus="hero-detail" onClick={() => onOpen(hero)}>详情</button>
        </div>
        {resuming && <div className="tv-hero-progress">
          {heroDuration > 0 && <span><i style={{ width: `${Math.min(100, Math.max(1, (heroSeconds / heroDuration) * 100))}%` }} /></span>}
          <small>{heroDuration > 0 ? `已看 ${fmtTime(heroSeconds)} · 共 ${fmtTime(heroDuration)}` : `已看到第 ${heroPart} 集`}</small>
        </div>}
      </div>
      {hero.cover && <div className="tv-hero-poster-wrap"><img className="tv-hero-poster" src={cover(hero.cover)} alt="" /></div>}
    </header>}
    <TvStatus busy={busy} error={error} onRetry={() => setRetry(r=>r+1)} />
    {rows.map((row, rowIndex) => {
      const visible = row.items.filter(content => !blockReason(content.tags));
      if (!visible.length) return null;
      return <section className="tv-shelf" key={row.title}><h2>{row.title}</h2><div className="tv-shelf-track" data-tv-region={`home-${row.title}`} data-tv-scroll-id={`home-${row.title}`}>
        {visible.map((content, index) => <TvCard key={contentKey(content)} content={content} onOpen={onOpen} onFocus={c => setAmbientCover(c.cover)} eager={rowIndex === 0 && index < 8} />)}
      </div></section>;
    })}
  </>;
}
