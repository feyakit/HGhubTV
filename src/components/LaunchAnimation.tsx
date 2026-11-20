import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { addPluginListener } from "@tauri-apps/api/core";
import { platform } from "../api";
import "../styles/launch.css";

// One reveal per WebView lifetime, including StrictMode and subsequent App remounts.
let launchCompleted = false;
export const LAUNCH_DURATION = 1450;
export type RegisterStartupBack = (handler: () => void) => () => void;

/** 影院极简开幕动画：柔和暖光呼吸 + 品牌标平滑浮现 + 字标微距收敛。 */
export function LaunchAnimation({ onFinish, registerBack }: { onFinish: () => void; registerBack?: RegisterStartupBack }) {
  const gradient = useId();
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const complete = useRef(false);
  const finish = useCallback(() => {
    if (complete.current) return;
    complete.current = true;
    finishRef.current();
  }, []);

  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setTimeout(finish, motion.matches ? 200 : LAUNCH_DURATION + 120);
    const onMotion = () => { if (motion.matches) finish(); };
    const onHidden = () => { if (document.visibilityState === "hidden") finish(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); finish(); }
    };
    motion.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onHidden);
    if (!registerBack) window.addEventListener("keydown", onKey, true);
    onHidden();
    return () => {
      window.clearTimeout(timer);
      motion.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [finish, registerBack]);

  useEffect(() => {
    if (registerBack) return registerBack(finish);
    if (platform !== "android") return;
    let disposed = false;
    let listener: { unregister: () => Promise<void> } | undefined;
    void addPluginListener("app", "back-button", finish).then(handle => {
      if (disposed) void handle.unregister().catch(() => {});
      else listener = handle;
    }).catch(() => {});
    return () => { disposed = true; void listener?.unregister().catch(() => {}); };
  }, [finish, registerBack]);

  return <div className="hg-launch" role="dialog" aria-modal="true" aria-label="HGhubTV 启动动画"
    onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === "launch-exit") finish(); }}>
    <div className="hg-launch-glow" aria-hidden="true" />
    <div className="hg-launch-stage" aria-hidden="true">
      <div className="hg-launch-mark">
        <svg className="hg-launch-svg" viewBox="0 0 64 64" fill="none">
          <defs><linearGradient id={gradient} x1="2" y1="0" x2="62" y2="64" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffd84a" /><stop offset="1" stopColor="#ff8a00" />
          </linearGradient></defs>
          <g className="hg-launch-tile">
            <rect width="64" height="64" rx="17" fill={`url(#${gradient})`} />
          </g>
          <path className="hg-launch-play" d="M25.5 18.6 47 32 25.5 45.4Z" fill="#14141c" />
        </svg>
      </div>
      <div className="hg-launch-wordmark"><span>HGhub</span><span className="hg-launch-word-tv">TV</span></div>
    </div>
    <span className="hg-launch-footnote" aria-hidden="true">CINEMA FOR TV</span>
  </div>;
}

/** Children mount after the reveal. 协议页不再拦启动：
 *  自用免费版，条款文本仍可在「设置 → 关于 → 查看使用协议」里读到，
 *  但不该让每次安装都卡在一屏法务文字上（用户明确要求去掉）。 */
export default function StartupGate({ children, registerBack }: { children: ReactNode; registerBack?: RegisterStartupBack }) {
  const [finished, setFinished] = useState(() => launchCompleted);
  const finish = useCallback(() => { launchCompleted = true; setFinished(true); }, []);
  if (!finished) return <LaunchAnimation onFinish={finish} registerBack={registerBack} />;
  return children;
}
