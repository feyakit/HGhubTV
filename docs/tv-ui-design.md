# 十英尺 UI 规格

面向电视 / 投影仪的界面，观看距离 2–3 米，输入设备只有遥控器五向键 + 确认键。
这份文档记录当前实现的尺寸基准与关键约束，改样式前先看这里，避免反复调数值。

## 尺寸基准

设计稿基于 **1280×720**。根字号不写死，按视口自适应：

```css
:root{
  font-size:1.875vw;                            /* 老内核兜底 */
  font-size:min(1.875vw, 3.333vh);              /* 1280×720 下 = 24px */
}
```

`1rem = 24px @1280×720`。所有尺寸以 rem 表达，等比缩放。

**注意**：`min()` 在 Chrome 79 以下整条失效，所以前面必须有一条普通值。

### 真机的 CSS 视口不是物理分辨率

实测：`wm size 1920x1080` + `wm density 240`（dpr 1.5）时，WebView 报 `innerWidth × innerHeight = 1280 × 636`，根字号算出来 **21.2px** 而不是 36px。系统状态栏 + 导航栏吃掉 126 物理像素，且 `min(1.875vw, 3.333vh)` 取到的是 vh 那一支。

本地 probe 如果用物理尺寸渲染，会**永远复现不出真机问题**。probe 要按 CSS 视口跑（`PROBE_W=1280 PROBE_H=636`）。

## 主要尺寸

| 元素 | 值 | 说明 |
|---|---|---|
| 顶部导航 | 高 `3.8rem` | 常驻，不随滚动消失；滚动时背景不透明度提到 `.99→.90` 并加投影，避免内容穿透叠字 |
| Hero 高度 | `min-height:46vh` | 左文右大幅海报，自然融入封面取色氛围层 |
| Hero 海报 | `11.8rem × 17.2rem` | 完整 2:3 竖版，不裁切 |
| Hero 标题 | `2.35rem` | 最多两行省略 |
| Hero 按钮 | `min-height:2.45rem` | 胶囊形，主按钮纯白底黑字，次按钮半透明磨砂 |
| 货架卡片 | `7.2rem` 宽，封面 `10.4rem` 高 | 纯净封面无底部文字遮罩，剧名与集数位于封面下方 |
| 宫格 | 5 列 | 发现页 / 搜索结果 / 片库（吃瓜视频为 3 列 16:9） |
| 行标题 | `1.05rem` | `rgba(245,247,250,.9)` |

### 字号下限

测试里有可读性断言：960 基准下 `strong` ≥ 13.5px、`small` ≥ 12px，即 1280 下至少 18px / 16px。当前卡片设置 `strong` 为 `0.92rem`、`small` 为 `0.78rem`，兼顾十英尺可读性与屏效。

## 焦点、氛围与导航

- **色彩与焦点态**：曜石深空底（`#090a0f`），焦点统一为纯白外环（`outline: .15rem solid #fff`）与柔和上浮放大，确保 `getComputedStyle(card).outlineStyle === "solid"`；琥珀金（`#f5c451`）仅克制用于进度条、评分与「接着看」标签。
- **封面动态取色**：`src/tv/colorExtract.ts` 采样封面主色调并缓存，驱动 `TvAmbient` 生成三层径向氛围光（遇跨域限制或无图时自动降级为柔和原图晕染）。
- **宫格/键盘必须整列**：`data-tv-columns` 要和每行实际元素数一致，某行少一个时 CSS Grid 会把后面的元素补到那一行末尾，上下键按固定列数算落点就会串位（搜索键盘实测过：第二行只有 9 个键时，第三行的 Z 被排到第二行末尾）。
- **区域切换**：↑ 进顶部悬浮导航，↓ 回内容区；发现页顶部分类胶囊（`browse-channels`）←→ 切换、↓ 进二级排序/榜单胶囊（`browse-subfilters`）或下方内容；区域之间靠 `data-tv-region` 标识。
- **初始焦点**：用 `data-tv-initial` 标记，`remote.ts` 的 `restoreFocus` 在检测到上次快照停在导航区时会丢弃快照，让 `data-tv-initial` 生效。

## 老内核红线（投影仪 Chrome 66）

产物里这些必须为 0：`@layer`、`aspect-ratio`、`color-mix(`、`:has(`、`@container`、`oklch(`。

闸门脚本 `scripts/check-legacy-css.mjs` 挂在 build 链末端，命中直接 `exit 1`。

补充约束：

- `clamp()` 会被 Vite 编成嵌套 `max(12px,min(...))`，Chrome 79 以下整条失效 → 必须补一条普通值在前。
- `mask-image` 必须带 `-webkit-` 前缀，Chrome 66 只认前缀版。
- `minmax()` 不算违规（Chrome 57 起支持），别和 `min()` 混。
- 中文字体在旧内核上渲染的行高更大，真机实际内容高度会超过按 probe 算的值。

## 排查「本地正常、真机不对」

**不要靠截图和视觉模型猜**，直接连 WebView 的 devtools 读真实布局：

```bash
adb shell cat /proc/net/unix | grep devtools     # @webview_devtools_remote_<pid>
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
curl -s http://127.0.0.1:9222/json               # 拿 webSocketDebuggerUrl
```

仓库里有现成脚本 `scripts/cdp-hero.py`，一次性返回 viewport、根字号、Hero/body/kicker 的 `top`/`height`、computed style。

**典型收获**：kicker 元素存在、文字颜色可见性全正常，但 `body.top = -7` 而 Hero 自己 `top = 34`——一眼看出是定位问题，不是高度问题。

## 已踩过的坑

| 症状 | 根因 |
|---|---|
| 元素最上面那段「凭空消失」 | **flex 容器上的 `overflow:hidden`** 创建 BFC，把唯一非 absolute 子项挤到容器外（实测偏上 41px）。改 `overflow:visible` 即恢复；要裁背景就给背景自己套 wrapper |
| `height:auto` 改了没效果 | 媒体查询里还留着 `height:46vh`，覆盖了外层的 `auto`。断点里要用 `min-height` |
| APK 字节两次完全一样 | `tauri-build` 不给 `../dist` 发 `rerun-if-changed`，`rust-cache` 复用旧 `.so`。`src-tauri/build.rs` 声明 `cargo:rerun-if-changed=../dist` 才是根治 |
| `fullscreen: true` 无效 | 这个字段只对桌面窗口有效，Android 上系统栏照旧显示。Android 的安全区要走 `src-tauri/tv/android/MainActivity.kt` 的 `setOnApplyWindowInsetsListener` |
| 详情页默认焦点落「返回列表」 | 按确认直接退出，用户以为坏了。给播放按钮加 `data-tv-initial` |
| 搜索键盘收起后焦点掉 body | 原焦点元素被卸载。收起时把焦点移回搜索框 |
