# AGENTS.md

给 AI 编码助手的项目约定。改代码前先读完这页。

## 这是什么项目

`HGhubTV` 是 [HGuoTok](https://github.com/feyakit/HGuoTok) 拆出来的 **Android TV 专用版**：
Tauri 2 + React 19 + TypeScript + Rust。**只出 Android TV 包**，手机版那套（手势、小窗、
底部 tab）在这个仓库里不启用。

- 许可证 **PolyForm Noncommercial 1.0.0**：禁止商用；`LICENSE` 里的
  `Required Notice` **必须保留**。
- 上游是 HGuoTok（它自己又是 HGhubX 的二次定制）。同步上游时按文件取，改完记得换品牌名。

## 和手机版最本质的区别

TV 没有触摸，只有遥控器。所有交互都要经过焦点：

| 手机 | TV |
|---|---|
| `touchstart` / `pointermove` | `keydown` 的 ArrowUp/Down/Left/Right |
| 直接点 | 焦点落在某个元素上，再按确认 |
| 手势拖动 | 方向键（`Feed.tsx` 里左右键 seek ±5s、上下键换剧） |

**焦点系统是 `src/tvNav.ts`（约 340 行）**，它负责：

- `FOCUSABLE` 选择器找可聚焦元素：`button/a/input/textarea/select/[tabindex]/[role=button]`
- 方向键按几何距离找下一个元素（主轴距离 + 副轴偏移惩罚）
- 三层作用域：弹层 > 栈页 + 导航条 > 整页
- 焦点栈：进栈页记住来源，退栈时恢复
- 三条「不靠几何」的特例，都是真机上被骂过的（改之前先看注释）：
  1. **Hero 上按下 = 第一行第一张卡**（几何会挑「正下方那张」，常是第 2、3 张）
  2. **第一行上按 = 回 Hero**（几何会跳到顶部导航，因为 x 恰好对齐）
  3. **顶栏下按 = 回 Hero**（几何会挑「正下方某张卡」，常在第 3 行）

## TV 首页：Netflix 骨架

```
顶部导航（浮层，滚动后上移隐藏，焦点进来再滑回）
  └ Hero 轮播 64vh（5 条，9 秒自动；焦点进入即暂停，左右键手动切）
      └ 分类 chip（全部/原创/热门短剧/AI 漫剧 + 站点真实分类，选了就换下面的货架，不跳页）
          └ 继续观看（横版 16:9 + 续看集数 + 进度条）
              └ 热播榜 Top10（左下大数字 + 描边）
                  └ 推荐给你 / 对应分类的货架（竖版 2:3）
```

- **chip 行必须挂 `data-row="分类"`**：Hero 按「下」只找 `section[data-row]`，
  不挂的话遥控器永远到不了分类，等于只能用鼠标点的死功能
- 轮播暂停靠 Hero 的 `focusin/focusout`；左右键由 `tvNav` 转成 `hg:hero` 事件
  （焦点在 Hero 里时左右本来没有别的用途）

尺寸按 **Notflix**（Android TV，Compose）的实测比例定，不要凭手感缩：

| 项 | 值 |
|---|---|
| 安全边距 | `clamp(48px, 5vw, 96px)`（约 4–5% 屏宽） |
| 顶栏 | 高 88px，导航 21px，Logo 36px 图标 + 25px 字标 |
| Hero | 64vh，海报 16vw，标题 `clamp(34px,3.2vw,56px)`，简介 `clamp(17px,1.35vw,21px)` |
| 主按钮 | 白底黑字，高 `clamp(48px,4.4vh,56px)`（次按钮白 14% 透明） |
| 行标题 | `clamp(20px,1.7vw,28px)`，粗体 |
| 海报卡 | `clamp(150px, 19vw, 260px)`（2:3），标题 15px，左上评分、右上集数 |
| 焦点 | 放大 1.22（`.tv-card`），行容器 `py-7` 预留裁切余量 |

- 布局参考 Netflix / 爱奇艺 TV / Notflix：顶部导航而非桌面侧栏（侧栏吃 176px，一屏少两张卡）
- **行标题联动**：焦点在哪行，那行标题点亮（`section[data-row].is-active-row`）
- Hero 背景：封面 `object-cover` 压暗 + 左强右弱黑渐变。**不要做 blur**——模糊底图会整块发灰，
  看着像「图没加载出来」；短剧没有横版剧照，别去找
- 不做 Hero 轮播：遥控器场景下，用户刚看清一张就换掉是负体验
- 首屏只看得到 Hero + 半行卡片，这是 Netflix 式的正常形态（按「下」滚到整行），
  不要为了「首屏露出完整一行」把 Hero 压回 55%

## 最容易犯的错误：把 button 换成 div

**页面看着一模一样，截图也看不出差别，但遥控器直接选不到那张卡。**

`tvNav` 只认 `FOCUSABLE` 里的标签。改样式时如果把 `<button>` 换成 `<div className="...">`，
焦点系统就找不到它了。这类 bug 只能靠断言拦——见 `scripts/test-tv-home.mjs` 里那条
`assert.equal(active.tag, "BUTTON")`。

## 构建

```bash
pnpm install
pnpm build              # 前端产物（legacy 降级恒开）
pnpm android:build      # 打 TV 补丁 + 出 APK，结束后自动 revert
pnpm test:tv-home       # TV 首页回归（顶栏 / Hero / 卡片可聚焦 / 方向键入行首）
BROWSER_EXECUTABLE=/path/to/chrome node scripts/preview-tv.mjs   # 布局截图，不用出包
```

本地通常**没有 cargo / rustc / NDK**，出包只能推 tag 让 CI 做。前端改动用 `pnpm build` 验。

**改布局先看截图**：`scripts/preview-tv.mjs` 用 mock 数据跑真实 App，1280×720 和
1920×1080 各出一张（含按一次下键的焦点态）。它会把 `127.0.0.1:17650/img?u=…`
（本地解密协议）302 到真实图片，所以浏览器里也能看到封面。跑出来的图在
`test-results/tv-preview/`。

## 踩过的坑（都真踩过，代价很大）

### 1. 删平台时，`beforeBuildCommand` 会漏

```json
"beforeBuildCommand": "pnpm build && node scripts/sync-android-icons.mjs && node scripts/sync-android-native.mjs"
```

原来还调 `generate-ios-icons.mjs` / `sync-ios-icons.mjs`。删掉 `src-tauri/icons/ios/` 之后
它们 ENOENT，**整个构建在第一步就挂**，五个平台全挂。

### 2. 删 CI 步骤时，它的副作用会跟着消失

「签名并收集手机版 APK」那步里有 `mkdir -p artifacts`。删掉这步之后，TV 的签名步骤
`apksigner --out artifacts/xxx.apk` 直接 `FileNotFoundException`——APK 其实编译成功了
（3 个 unsigned 都在），只是签不出来。

**删流程前先看它顺带建立了什么**：目录、环境变量、生成的文件。

### 3. CI 里的测试可能绑死手机 DOM

- `test:api-loading` 原来等 `history.length === 1`（手机版首页只发一个请求），
  TV 首页同时拉 feed + 货架行 + 榜单，永远不会等于 1。现在改成按命令等
  `api_feed`，失败文案也改成 `/首页加载失败/`（TV 版带冒号和错误详情）。
- `test:playback` 的 interaction 场景要**点按视频区域**，TV 没有触摸事件，仍然超时。

`test:api-loading` 已在 CI 注释掉，换成 `test:tv-home`；本地把上面那两处改好后可以跑通。

### 4. JDK 版本要锁

`ubuntu-latest` 的默认 JDK 会随镜像升级。2026-11 升到 25 之后 Gradle 8.14 报
`Unsupported class file major version 69`，7 秒就挂。workflow 里已经用
`actions/setup-java` 锁到 17。

### 5. iOS 图标的 `source.svg`（如果以后加回 iOS）

`generate-ios-icons.mjs` 校验 `sourceSvg.split("<g", 1)[0]`——只看第一个 `<g>` 之前的部分，
前提是背景正方形、不带 `rx`/`stroke`，且**内容必须包在 `<g>` 里**，否则整个文件都算背景。

## 代码约定

- **注释和提交信息用中文**，解释「为什么」而不是「做了什么」
- 提交署名：`git -c user.name="feyakit" -c user.email="feya0517@gmail.com" commit`
- 新 UI 一律用 `<button>`（可聚焦），别用 `<div onClick>`
- 焦点相关改动后跑 `pnpm test:tv-home`

## 别做的事

- 删 `LICENSE` 的版权声明
- 把 `<button>` 改成 `<div>`（遥控器会失灵）
- 在 `[class*="h-[2px]"]` 这类选择器上做假设——那是 tailwind 动态类，改布局时会变
- 不跑 `pnpm build` 就提交

## 发版与验证的坑

### 删 tag 重建会让 Release 错位

`git tag -d v1.0.0 && git push --delete origin v1.0.0 && git tag v1.0.0 && git push origin v1.0.0`
之后，**旧 Release 仍然占着 `v1.0.0` 这个名字**，新构建上传的资产会落到一个
`untagged-<hash>` 的 Release 里。结果是：

```
gh release view v1.0.0  → 显示资产齐全，URL 看着也对
curl .../releases/download/v1.0.0/xxx.apk → 404
```

更坑的是如果原 Release 是 **Draft**，`/download/` 链接一律 404，只有
`/releases/download/untagged-.../` 能访问。判断方法：

```bash
gh api repos/feyakit/HGhubTV/releases -q '.[] | "\(.tag_name) draft=\(.isDraft)"'
```

重建 tag 之后一定要 `gh release edit v1.0.0 --draft=false --prerelease`。

### 下包不要走 `/releases/download/`

CDN 对刚发布的 Release 可能还是 404，而且带查询参数（`?cb=123`）会直接 404
（9 字节的 "Not Found" 存成 .apk）。用认证 API 拉：

```bash
gh release download v1.0.0 --pattern "*x86_64*" --dir .
```

### instabox 是 x86_64：别用 arm64 包做交互测试

`adb install` 能装上 arm64 包（有翻译层），首屏也能看，但**一按方向键就可能把
`libndk_translation.so` 的优化循环打崩**——应用直接退回桌面，crash buffer 里全是
`ndk_translation::x86_64::OptimizeLoop`，看起来像「按右键 App 就崩」。
开发包现在也出 x86_64（`build-android.yml` 里 `TARGETS` 固定三个 ABI），
UI 断言一律用 `*_x86_64.apk`，别省那两分钟构建。

### adb install 的输出不要截断

```bash
adb install -r x.apk 2>&1 | tail -1     # ✗ 只剩 "Complete"，那是 am start 的输出
adb install -r x.apk 2>&1               # ✓ 要看 Success / Failure 原文
```

`INSTALL_PARSE_FAILED_NOT_APK` 就是下载文件不对（9 字节），不是签名问题。

### 截图字节数是最快的「装没装上」判断

同一页面同一设备，截图大小几乎固定。数字没变 = 装的还是旧包。
先查 `adb shell dumpsys package <pkg> | grep lastUpdateTime` 再谈代码有没有生效。

## TV 上的调试手段：WebView CDP

TV 没有 DevTools，`console.log` 也不进 logcat（MainActivity 没配 `WebChromeClient`）。
`android-tv-patch.py` 已经默认打开 `WebView.setWebContentsDebuggingEnabled(true)`，
配合 adb forward 可以直连：

```bash
PID=$(adb shell pidof com.hghubtv.app | tr -d "\r")
adb forward tcp:9333 localabstract:webview_devtools_remote_$PID
curl http://127.0.0.1:9333/json          # 拿 webSocketDebuggerUrl
node scripts/cdp-probe.mjs               # DOM 里 img 的 src/naturalWidth/opacity
```

`scripts/cdp-probe*.mjs` 三个探针分别查：DOM 状态、React fiber 里的组件 props、
直接 invoke 后端命令看原始数据。三者一对照，问题在哪一层一目了然——
TV 首页封面全空的 bug 就是这么定位的（`cover()` 不幂等，被调了两次）。

## 真机才能验的（别指望模拟器）

1. 遥控器**第一下方向键**会不会被系统吃掉（`MainActivity` 里 `webView.requestFocus()` 就是为这个）
2. 焦点框在 3 米外看不看得清（3px 白描边 + 6px 光晕）
3. 老电视 WebView（Chrome 6x–9x）会不会白屏
4. 16:9 下的留白比例

模拟器（尤其 Redroid）在这些事上一律不准，而且横屏 + 弱 GPU 容易把整个系统搞崩
（我们遇到过一次 `DeadSystemException`）。

## 老 WebView 兼容（投影仪 / 老盒子，下限 Chrome 66）

实测设备：OBE X7D Pro 投影仪 = Android 9 + **WebView 66**；TCL MT5879 电视 = Android 11。

- **禁止在 inline style 里写 `clamp()` / `min()` / `max()`**。Chrome 66 不认，CSS 解析器
  直接丢弃整条声明 —— 卡片宽度变 0，整排货架消失（页面看起来"只有标题没有内容"）。
  尺寸一律走 `src/index.css` 的 `--tv-*` 变量：`:root` 给固定值（720p 视口标定），
  `@supports (width: clamp(1px,1vw,2px))` 里再换成比例值。
- **变量必须定义在 `:root`**，不能只在 `.is-tv-root` 上：测试 fixture 渲染 Home 时没有
  那层壳，取不到变量同样是宽 0。
- **Chrome 66 缺的运行时 API**：`Promise.allSettled`(76)、`Array.flatMap`(69)、`globalThis`(71)。
  `src/polyfills.ts` 里有手写兜底，新增代码用到别的新 API 要先在那里补。
- **flex `gap` 到 Chrome 84 才生效**（属性存在但被忽略）。`polyfills.ts` 会检测并给
  `<html>` 挂 `.no-flex-gap`，横向货架靠 `margin-left` 兜底。
- 语法降级：`vite.config.ts` 的 `build.target = ["chrome66"]`，`plugin-legacy` 的
  `modernTargets` 也是 66。**别改回 80+**，Chrome 66 支持 ESM 所以会拿到 modern chunk，
  里面留着 `?.`/`??` 就整页白屏。
- **APK 必须带 v1 签名**：minSdk 24+ 时 apksigner 默认只写 v2/v3，TCL 的安装校验只认
  JAR 签名，缺 v1 直接 `INSTALL_FAILED_VERIFICATION_FAILURE`。CI 里已显式开 `--v1-signing-enabled true`。
