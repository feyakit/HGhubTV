#!/usr/bin/env python3
"""通过 Chrome DevTools Protocol 读云机上 WebView 的真实布局数值。

用途：tv-hero 的 kicker 在真机上不显示，本地 probe 却正常。与其继续猜 CSS，
不如直接问渲染器：视口多大、Hero 计算高度多少、kicker 元素是否存在、在哪。
"""
import base64
import json
import os
import socket
import struct
import sys
import urllib.request

PORT = 9222


def targets():
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=10) as r:
        return json.loads(r.read().decode())


def connect(ws_url: str) -> socket.socket:
    # ws://127.0.0.1:9222/devtools/page/XXXX
    path = "/" + ws_url.split("/", 3)[3]
    s = socket.create_connection(("127.0.0.1", PORT), timeout=15)
    key = base64.b64encode(os.urandom(16)).decode()
    req = (
        f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    s.sendall(req.encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = s.recv(4096)
        if not chunk:
            raise RuntimeError("WS 握手失败")
        buf += chunk
    return s


def send(s: socket.socket, payload: dict) -> None:
    data = json.dumps(payload).encode()
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    header = b"\x81"
    n = len(data)
    if n < 126:
        header += bytes([0x80 | n])
    elif n < 65536:
        header += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        header += bytes([0x80 | 127]) + struct.pack(">Q", n)
    s.sendall(header + mask + masked)


def recv(s: socket.socket) -> str:
    head = s.recv(2)
    if len(head) < 2:
        return ""
    n = head[1] & 0x7F
    if n == 126:
        n = struct.unpack(">H", s.recv(2))[0]
    elif n == 127:
        n = struct.unpack(">Q", s.recv(8))[0]
    data = b""
    while len(data) < n:
        chunk = s.recv(n - len(data))
        if not chunk:
            break
        data += chunk
    return data.decode("utf-8", "ignore")


EXPR = r"""
(() => {
  const q = (sel) => document.querySelector(sel);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width),
            display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
            color: cs.color, fontSize: cs.fontSize, overflow: cs.overflow};
  };
  const hero = q('.tv-hero');
  const body = q('.tv-hero-body');
  const kicker = q('.tv-hero-kicker');
  const cs = hero ? getComputedStyle(hero) : null;
  return JSON.stringify({
    viewport: {w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
               vh1: Math.round(innerHeight / 100)},
    rootFont: getComputedStyle(document.documentElement).fontSize,
    heroCss: cs ? {height: cs.height, minHeight: cs.minHeight, overflow: cs.overflow,
                   display: cs.display, alignItems: cs.alignItems} : null,
    heroBox: box(hero),
    bodyBox: box(body),
    kickerExists: !!kicker,
    kickerText: kicker ? kicker.textContent : null,
    kickerBox: box(kicker),
    kickerOffsetTop: kicker ? Math.round(kicker.getBoundingClientRect().top - hero.getBoundingClientRect().top) : null,
    stylesheets: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href.split('/').pop()),
    bodyComputed: body ? (() => { const c = getComputedStyle(body);
      return {position: c.position, bottom: c.bottom, top: c.top, margin: c.margin,
              padding: c.padding, height: c.height}; })() : null,
    heroComputed: cs ? {height: cs.height, minHeight: cs.minHeight} : null,
    bodyExtra: body ? (() => { const c = getComputedStyle(body);
      return {transform: c.transform, alignSelf: c.alignSelf, flex: c.flex,
              order: c.order, position: c.position, top: c.top, inset: c.inset}; })() : null,
    heroChildren: hero ? [...hero.children].map(el => { const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {cls: el.className, position: c.position, top: Math.round(r.top), h: Math.round(r.height)}; }) : null,
    heroPadding: cs ? cs.padding : null,
    bodyParent: body ? body.parentElement.className : null,
    bodyIndexInHero: body && hero ? [...hero.children].indexOf(body) : null,
  }, null, 1);
})()
"""


def main() -> int:
    ts = [t for t in targets() if t.get("type") == "page"]
    if not ts:
        print("没有可调试的 page", file=sys.stderr)
        return 1
    t = ts[0]
    print(f"target: {t.get('url')}")
    s = connect(t["webSocketDebuggerUrl"])
    send(s, {"id": 1, "method": "Runtime.evaluate",
             "params": {"expression": EXPR, "returnByValue": True, "awaitPromise": False}})
    for _ in range(20):
        raw = recv(s)
        if not raw:
            break
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if msg.get("id") == 1:
            res = msg.get("result", {})
            if "exceptionDetails" in res:
                print("JS 异常:", json.dumps(res["exceptionDetails"], ensure_ascii=False)[:600])
                return 1
            print(res.get("result", {}).get("value"))
            return 0
    print("没收到求值结果", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
