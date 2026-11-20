#!/usr/bin/env python3
"""把 Android 的 MainActivity 改成沉浸式：隐藏状态栏和导航栏。

为什么不用 tauri.conf.json 的 fullscreen：
实测 `"fullscreen": true` 在 Android 上不生效 —— 配置确实打进了 APK
（解开 assets/tauri.conf.json 能看到），但系统栏照旧占着 36px + 90px，
Hero 标题仍被状态栏压住。Tauri 2 的这个字段只对桌面窗口有效。

为什么不用 CSS padding 兜住：
状态栏+导航栏吃掉约 12% 屏高，给内容加等量 padding 会让投影仪/TV
（本来就全屏无系统栏）白留一块边。真正的解法是让系统栏不显示。

gen/android 由 `tauri android init` 在 CI 里生成，本地没有，所以这个
补丁只能在 init 之后、build 之前执行。
"""

import pathlib
import re
import sys

HIDE = """
        // 沉浸式：隐藏系统状态栏和导航栏（HGhubTV 新增）
        // 全屏铺满后 Hero 不再被状态栏压住，遥控器/触摸也不会误触系统栏。
        androidx.core.view.WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
"""


def patch(path: pathlib.Path) -> bool:
    s = path.read_text(encoding="utf-8")
    if "BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE" in s:
        print(f"已打过补丁，跳过：{path}")
        return True

    # 必须在 super.onCreate 之后：之前 window.decorView 还没准备好。
    m = re.search(r"super\.onCreate\(savedInstanceState\)\s*", s)
    if not m:
        print(f"找不到 super.onCreate(savedInstanceState)：{path}", file=sys.stderr)
        return False
    insert_at = m.end()
    s = s[:insert_at] + HIDE + s[insert_at:]
    path.write_text(s, encoding="utf-8")
    print(f"已注入沉浸式补丁：{path}")
    return True


def main() -> int:
    root = pathlib.Path("src-tauri/gen/android")
    found = list(root.rglob("MainActivity.kt"))
    if not found:
        print(f"{root} 下没有 MainActivity.kt —— 先跑 tauri android init", file=sys.stderr)
        return 1
    ok = all(patch(p) for p in found)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
