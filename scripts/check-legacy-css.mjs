#!/usr/bin/env node
/* 旧内核闸门：这批特性在 Chrome 66 / 87 上不生效，命中就拦下。
   老设备（投影仪 Chrome 66、小米9 Chrome 87）装的是同一个包，不能只在新内核上验证。 */
import { readdirSync, readFileSync } from "node:fs";

// 只有 TV 产物要跑在 Chrome 66/87 上；手机版是给现代 WebView 的，不在检查范围
if (process.env.VITE_APP_EDITION !== "tv") {
  console.log("非 TV 构建，跳过旧内核检查");
  process.exit(0);
}

const dir = "dist/assets";
const css = readdirSync(dir)
  .filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(`${dir}/${name}`, "utf8"))
  .join("\n");

// 剥掉不该参与检查的部分：
// 1) @supports not (...) 的整块是给旧内核的兜底写法
// 2) @media (max-aspect-ratio) 这类条件本身是旧内核支持的媒体特性，不是 CSS 属性
const body = css
  .replace(/@supports not \([^{]*\)\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
  .replace(/@media[^{]*\{/g, "@media{")
  .replace(/@supports[^{]*\{/g, "@supports{");

const banned = [
  ["@layer", "@layer：旧内核整块丢弃（表现为整页没样式）"],
  ["aspect-ratio:", "aspect-ratio：Chrome 88+，旧内核高度塌成 0"],
  ["@container", "@container：Chrome 105+"],
  [":has(", ":has()：Chrome 105+"],
  ["oklch(", "oklch()：Chrome 111+"],
  ["color-mix(", "color-mix()：Chrome 111+"],
];

let failed = 0;
for (const [needle, why] of banned) {
  const count = body.split(needle).length - 1;
  if (count) {
    console.error(`FAIL ${needle} × ${count} — ${why}`);
    failed += 1;
  }
}

// min()/max() 是 Chrome 79+：只允许出现在有旧值兜底的地方，这里只提示不拦截
const rangeFns = (body.match(/\b(?:min|max|clamp)\(/g) || []).length;
if (rangeFns) console.warn(`WARN min/max/clamp × ${rangeFns} — Chrome 79+，需要前一条普通值兜底`);

if (failed) {
  console.error(`\n旧内核兼容检查失败：${failed} 项`);
  process.exit(1);
}
console.log("legacy-css ok");
