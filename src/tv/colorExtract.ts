import { useEffect, useState } from "react";
import { cover } from "../api";

export interface CoverPalette {
  /** 深沉氛围底色，例如 "18, 28, 46" */
  deepRgb: string;
  /** 中亮氛围光晕色，例如 "92, 54, 34" */
  glowRgb: string;
  /** 柔和提亮点缀色，例如 "218, 174, 108" */
  accentRgb: string;
}

const MAX_CACHE = 40;
const paletteCache = new Map<string, CoverPalette | null>();
const inflight = new Map<string, Promise<CoverPalette | null>>();

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = clampByte(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return [
    clampByte(hue2rgb(h + 1 / 3) * 255),
    clampByte(hue2rgb(h) * 255),
    clampByte(hue2rgb(h - 1 / 3) * 255),
  ];
}

/** 从已加载的封面中提取影院级深色调色板；遇到跨域限制或失败时返回 null */
export function extractCoverPalette(url: string): Promise<CoverPalette | null> {
  if (!url) return Promise.resolve(null);
  if (paletteCache.has(url)) return Promise.resolve(paletteCache.get(url) ?? null);
  const pending = inflight.get(url);
  if (pending) return pending;

  const task = new Promise<CoverPalette | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let settled = false;
    const finish = (value: CoverPalette | null) => {
      if (settled) return;
      settled = true;
      if (paletteCache.size >= MAX_CACHE) {
        const oldest = paletteCache.keys().next().value;
        if (oldest !== undefined) paletteCache.delete(oldest);
      }
      paletteCache.set(url, value);
      inflight.delete(url);
      resolve(value);
    };

    const timer = window.setTimeout(() => finish(null), 2500);

    img.onload = () => {
      window.clearTimeout(timer);
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) { finish(null); return; }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        // 按 12 个色相桶聚合，避开过黑、过白与低饱和灰
        const buckets = new Array(12).fill(0).map(() => ({ weight: 0, r: 0, g: 0, b: 0 }));
        let fallbackR = 0, fallbackG = 0, fallbackB = 0, fallbackW = 0;

        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 180) continue;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const [h, s, l] = rgbToHsl(r, g, b);
          if (l < 0.08 || l > 0.92) continue;

          fallbackR += r; fallbackG += g; fallbackB += b; fallbackW += 1;
          if (s < 0.14) continue;

          const idx = Math.min(11, Math.floor(h * 12));
          const weight = s * (1 - Math.abs(l - 0.45));
          buckets[idx].weight += weight;
          buckets[idx].r += r * weight;
          buckets[idx].g += g * weight;
          buckets[idx].b += b * weight;
        }

        let best = buckets[0];
        for (const bucket of buckets) {
          if (bucket.weight > best.weight) best = bucket;
        }

        let baseR = 46, baseG = 58, baseB = 82;
        if (best.weight > 0) {
          baseR = best.r / best.weight;
          baseG = best.g / best.weight;
          baseB = best.b / best.weight;
        } else if (fallbackW > 0) {
          baseR = fallbackR / fallbackW;
          baseG = fallbackG / fallbackW;
          baseB = fallbackB / fallbackW;
        } else {
          finish(null);
          return;
        }

        const [h, s] = rgbToHsl(baseR, baseG, baseB);
        const safeSat = Math.min(0.68, Math.max(0.26, s));
        const deep = hslToRgb(h, Math.min(0.55, safeSat), 0.14);
        const glow = hslToRgb(h, safeSat, 0.34);
        const accent = hslToRgb(h, Math.min(0.75, safeSat + 0.1), 0.68);

        finish({
          deepRgb: deep.join(", "),
          glowRgb: glow.join(", "),
          accentRgb: accent.join(", "),
        });
      } catch {
        // 跨域未开 ACAO 头时 Canvas 会抛 SecurityError，静默降级
        finish(null);
      }
    };

    img.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };

    img.src = url;
  });

  inflight.set(url, task);
  return task;
}

/** 订阅封面图动态调色板，用于沉浸式氛围光晕 */
export function useCoverPalette(src?: string | null): CoverPalette | null {
  const resolved = src ? cover(src) : "";
  const [palette, setPalette] = useState<CoverPalette | null>(() =>
    resolved && paletteCache.has(resolved) ? (paletteCache.get(resolved) ?? null) : null
  );

  useEffect(() => {
    if (!resolved) {
      setPalette(null);
      return;
    }
    if (paletteCache.has(resolved)) {
      setPalette(paletteCache.get(resolved) ?? null);
      return;
    }
    let alive = true;
    void extractCoverPalette(resolved).then((result) => {
      if (alive) setPalette(result);
    });
    return () => { alive = false; };
  }, [resolved]);

  return palette;
}
