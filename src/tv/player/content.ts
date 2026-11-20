import type { Detail, PlayInfo, Post } from "../../types";
import type { TvContent } from "../model";

export type TvPart = { id: string; label: string; duration?: number };
export type TvStreams = { main: string; hevc?: string };

export function detailContent(base: TvContent, value: Detail | Post): TvContent {
  return {
    kind: base.kind, id: base.id, title: value.title || base.title,
    cover: value.cover || base.cover, tags: Array.isArray(value.tags) ? value.tags : [],
    description: base.kind === "video" ? (value as Detail).description : (value as Post).desc,
    hot: base.kind === "video" ? (value as Detail).counts?.hot ?? base.hot : (value as Post).hot ?? (value as Post).counts?.hot ?? base.hot,
    ...(base.kind === "video" ? { score: (value as Detail).score, episodeCount: (value as Detail).episode_count } : {}),
  };
}

export function videoParts(value: Detail): TvPart[] {
  const seen = new Set<string>();
  const episodes = value.episodes?.length ? value.episodes : Array.from({ length: Number.isSafeInteger(value.episode_count) ? Math.min(10000, Math.max(0, value.episode_count)) : 0 }, (_, index) => ({ ep_num: index + 1, title: "", duration: 0, status: 1 }));
  return episodes.filter(episode => {
    const id = String(episode.ep_num);
    if (!Number.isInteger(episode.ep_num) || episode.ep_num < 1 || seen.has(id)) return false;
    seen.add(id); return true;
  }).sort((a, b) => a.ep_num - b.ep_num).map(episode => ({
    id: String(episode.ep_num),
    label: String(episode.ep_num),
    duration: episode.duration,
  }));
}

export function postParts(videos: { index: number; url: string }[] = []): TvPart[] {
  const seen = new Set<string>();
  return videos.filter(video => {
    const id = String(video.index);
    if (!Number.isInteger(video.index) || !video.url?.trim() || seen.has(id)) return false;
    seen.add(id); return true;
  }).map((video, position) => ({ id: String(video.index), label: String(position + 1) }));
}

export function playStreams(info: PlayInfo, expectedId: number, expectedPart: string): TvStreams {
  /* 后端契约不总对得上：实测投影仪上 /playback 返回的 id / ep_num 和请求的
     集号不一致，原代码直接抛「播放信息已变化」，播放根本进不去。
     「别播错集」由 PlayerPage 的 request/serial 会话号保证（旧响应会被丢弃），
     这里只要求拿到地址就用。字段不符仅记一条，便于排查。 */
  if (info.id != null && info.id !== expectedId || info.ep_num != null && String(info.ep_num) !== expectedPart) {
    console.warn("[play] 播放信息字段与请求不符", { gotId: info.id, gotEp: info.ep_num, expectedId, expectedPart });
  }
  const main = info.streams?.main || info.video_url;
  const hevc = info.streams?.hevc || info.video_url_hevc;
  if (!main && !hevc) throw new Error("当前剧集暂无可用播放地址，请重试");
  return { main: main || hevc!, hevc: hevc || undefined };
}

export function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
}
