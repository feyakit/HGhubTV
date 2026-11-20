import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cover } from "../api";
import { useContentPreferences } from "../contentPreferences";
import { useCoverPalette } from "./colorExtract";
import { contentKey, type TvContent } from "./model";
import { focusElement, focusables, useRemoteScope } from "./remote";

/** 页面级氛围层：优先使用封面提取出的影院色调生成径向环境光；
 *  若遇跨域或无封面，则平滑退化为柔和原图晕染或影院深空氛围。 */
export function TvAmbient({ src }: { src?: string | null }) {
  const palette = useCoverPalette(src);
  const style: CSSProperties | undefined = palette
    ? {
        backgroundImage: `radial-gradient(ellipse 74% 62% at 72% 18%, rgba(${palette.glowRgb}, .42) 0%, rgba(${palette.deepRgb}, .26) 46%, transparent 78%), radial-gradient(ellipse 52% 48% at 22% 8%, rgba(${palette.accentRgb}, .12) 0%, transparent 72%)`,
      }
    : undefined;
  return (
    <div className={`tv-ambient${src ? "" : " tv-ambient-brand"}`} aria-hidden>
      {src && <div className="tv-ambient-image" style={{ backgroundImage: `url("${cover(src)}")` }} />}
      <div className="tv-ambient-color" style={style} />
    </div>
  );
}

export function TvCard({ content, onOpen, onFocus, placeholder = false, progress, wide = false, eager = false }: { content: TvContent; onOpen: (content: TvContent) => void; onFocus?: (content: TvContent) => void; placeholder?: boolean; progress?: { part: string; seconds: number; duration: number }; wide?: boolean; eager?: boolean }) {
  const { blockReason } = useContentPreferences();
  const blocked = blockReason(content.tags);
  if (blocked && !placeholder) return null;
  return <button className={`tv-card ${content.kind === "post" || wide ? "tv-card-wide" : ""}`} data-tv-focus={contentKey(content)} onClick={() => onOpen(content)} onFocus={() => onFocus?.(content)} aria-label={blocked ? "已屏蔽的内容" : content.title}>
    <div className="tv-card-art">{blocked ? <span className="tv-neutral">已屏蔽</span> : content.cover ? <img src={cover(content.cover)} alt="" loading={eager ? "eager" : "lazy"} decoding="async" onError={event => {
      /* 海报 CDN 偶发超时，整行空白能持续好几秒。同一个 URL 再拉一次通常就回来了；
         已经重试过就藏掉，让下面的骨架底色露出来，不要留一个碎图图标。 */
      const img = event.currentTarget;
      if (img.dataset.retried) { img.style.visibility = "hidden"; return; }
      img.dataset.retried = "1";
      const original = img.src; img.src = ""; img.src = original;
    }} /> : <span className="tv-neutral">HGhubTV</span>}
      {!blocked && !!content.score && <span className="tv-score">{content.score.toFixed(1)}</span>}
      {!blocked && progress && progress.duration > 0 && (
        <span className="tv-progress"><i style={{ width: `${Math.min(100, Math.max(2, (progress.seconds / progress.duration) * 100))}%` }} /></span>
      )}</div>
    <strong>{blocked ? "已屏蔽的内容" : content.title}</strong><small>{blocked ? "记录已保留" : content.kind === "post" ? "吃瓜视频" : content.episodeCount ? `${content.episodeCount} 集` : "查看详情"}</small>
  </button>;
}
export function TvModal({ id, title, onClose, children }: { id: string; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const trigger = document.activeElement as HTMLElement;
    focusElement(focusables(ref.current!)[0]);
    return () => { requestAnimationFrame(() => { if (trigger?.isConnected) focusElement(trigger); }); };
  }, []);
  useRemoteScope({ id, priority: 100, onKey: key => { if (key === "back") { onClose(); return true; } } });
  return <div className="tv-modal-backdrop"><div ref={ref} data-tv-modal={id} className="tv-modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
    <header data-tv-region={`${id}-header`}><h2 id={`${id}-title`}>{title}</h2><button data-tv-focus={`${id}-close`} onClick={onClose}>关闭</button></header>{children}
  </div></div>;
}
export function TvStatus({ busy, error, onRetry, empty }: { busy?: boolean; error?: string; onRetry?: () => void; empty?: string }) {
  return <div className="tv-status" role="status">{busy ? "正在加载…" : error || empty}{!busy && error && onRetry && <button data-tv-focus="retry" onClick={onRetry}>重试</button>}</div>;
}
