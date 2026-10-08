import { chromium } from "playwright";

const BASE = process.env.BASE || "http://127.0.0.1:8899";
const browser = await chromium.launch();

const AUDIT = () => {
  const out = { offscreen: [], overlap: [], clip: [], contrast: [], layout: {} };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  out.layout.scrollW = document.documentElement.scrollWidth;
  out.layout.hOverflow = document.documentElement.scrollWidth > vw + 1;

  const measure = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getBoundingClientRect();
  };

  // bodies: on-screen + text not clipped by its chip
  document.querySelectorAll(".body").forEach((el) => {
    const r = el.getBoundingClientRect();
    const id = el.dataset.sheet;
    if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
      out.offscreen.push({ id, l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) });
    }
    el.querySelectorAll(".body-name, .body-title, .body-line, .body-sub, .body-meta, .body-kicker").forEach((t) => {
      const m = measure(t);
      if (m.width > r.width - 8 || m.right > r.right - 6) {
        out.clip.push({ id, cls: t.className, textW: Math.round(m.width), boxW: Math.round(r.width) });
      }
    });
  });

  // body ↔ body overlap
  const list = [...document.querySelectorAll(".body")].map((el) => el.getBoundingClientRect());
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 12 && oy > 12) {
        out.overlap.push({ i, j, ox: Math.round(ox), oy: Math.round(oy) });
      }
    }
  }

  // chrome never covered by a body
  const zones = [
    [".top", "top-chrome"],
    [".bottom", "bottom-chrome"],
  ];
  for (const [sel, name] of zones) {
    const z = document.querySelector(sel).getBoundingClientRect();
    for (const el of document.querySelectorAll(".body")) {
      const r = el.getBoundingClientRect();
      const ox = Math.min(z.right, r.right) - Math.max(z.left, r.left);
      const oy = Math.min(z.bottom, r.bottom) - Math.max(z.top, r.top);
      if (ox > 10 && oy > 10) out.overlap.push({ chrome: name, body: el.dataset.sheet, oy: Math.round(oy) });
    }
  }

  // contrast
  const lum = (c) => {
    const m = c.match(/\d+(\.\d+)?/g).map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
      n = n.parentElement;
    }
    return "rgb(7,9,16)";
  };
  const probes = [
    [".wordmark", "wordmark"],
    [".body-name", "body-name"],
    [".body-line", "body-line"],
    [".body-meta", "body-meta"],
    [".body-sub", "body-sub"],
    [".hint", "hint"],
    [".foot-meta", "foot"],
    [".ink", "ink-btn"],
  ];
  for (const [sel, name] of probes) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = ratio(getComputedStyle(el).color, bgOf(el));
    out.contrast.push({ name, ratio: +r.toFixed(2), ok: r >= 4.5 });
  }
  return out;
};

async function run(w, h, label) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  p.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text()); });
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.waitForFunction(() => window.__tinct && window.__tinct.particles > 0);
  await p.waitForTimeout(2200);

  const r = await p.evaluate(AUDIT);
  const bad = [
    r.layout.hOverflow ? `H-OVERFLOW ${r.layout.scrollW}>${r.layout.viewW}` : null,
    ...r.offscreen.map((o) => `OFFSCREEN ${o.id} ${o.l},${o.t},${o.r},${o.b}`),
    ...r.clip.map((c) => `CLIP ${c.id}/${c.cls} ${c.textW}>${c.boxW}`),
    ...r.overlap.map((o) => `OVERLAP ${JSON.stringify(o)}`),
    ...r.contrast.filter((c) => !c.ok).map((c) => `CONTRAST ${c.name} ${c.ratio}`),
  ].filter(Boolean);

  console.log(`\n===== ${label} ${w}×${h} (live) =====`);
  console.log(bad.length ? bad.map((b) => "  " + b).join("\n") : "  clean");

  // layout truth: freeze every body at its home and measure again
  await p.evaluate(() => window.__tinct.snap());
  await p.waitForTimeout(140);
  const r2 = await p.evaluate(AUDIT);
  const bad2 = [
    ...r2.offscreen.map((o) => `OFFSCREEN ${o.id} ${o.l},${o.t},${o.r},${o.b}`),
    ...r2.clip.map((c) => `CLIP ${c.id}/${c.cls} ${c.textW}>${c.boxW}`),
    ...r2.overlap.map((o) => `OVERLAP ${JSON.stringify(o)}`),
  ].filter(Boolean);
  console.log(`----- (pinned to home) -----`);
  console.log(bad2.length ? bad2.map((b) => "  " + b).join("\n") : "  clean");
  if (!bad2.length) {
    const info = await p.evaluate(() => ({
      bodies: window.__tinct.bodies.length,
      particles: window.__tinct.particles,
      energy: window.__tinct.fieldEnergy(),
    }));
    console.log("  " + JSON.stringify(info));
  } else {
    console.log("  " + JSON.stringify(await p.evaluate(() => window.__tinct.homes())));
  }
  await p.evaluate(() => window.__tinct.thaw());
  await ctx.close();
}

await run(1440, 900, "desktop");
await run(1280, 800, "laptop");
await run(834, 1112, "tablet");
await run(390, 844, "phone");

// interaction: stir the vat, throw a body, open + close a sheet
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(BASE, { waitUntil: "networkidle" });
await p.waitForFunction(() => window.__tinct && window.__tinct.particles > 0);
await p.waitForTimeout(1800);

console.log("\n===== interaction =====");
const before = await p.evaluate(() => window.__tinct.bodies.map((b) => b.sheet + ":" + b.x + "," + b.y));
console.log("  rest     ", before.join("  "));

// stir
for (let i = 0; i <= 20; i++) {
  const x = 240 + i * 46;
  const y = 430 + Math.sin(i * 0.5) * 150;
  await p.mouse.move(x, y);
  await p.waitForTimeout(16);
}
const e1 = await p.evaluate(() => window.__tinct.fieldEnergy());
console.log("  stirred  energy", e1);

// throw the CTA body
const t = await p.evaluate(() => window.__tinct.bodies.find((b) => b.sheet === "batch"));
await p.mouse.move(t.x, t.y);
await p.mouse.down();
for (let i = 1; i <= 10; i++) await p.mouse.move(t.x + i * 34, t.y - i * 22);
await p.mouse.up();
await p.waitForTimeout(260);
const after = await p.evaluate(() => window.__tinct.bodies.find((b) => b.sheet === "batch"));
console.log("  thrown   batch now", after.x, after.y, "(was", t.x, t.y + ")");

// click to open — use the element itself so we hit its live centre
await p.locator('.body[data-sheet="batch"]').click({ force: true });
await p.waitForTimeout(560);
console.log("  sheet    ", await p.evaluate(() => ({ open: !document.getElementById("sheet").hidden, panel: document.querySelector("[data-panel]:not([hidden])")?.dataset.panel })));

await p.keyboard.press("Escape");
await p.waitForTimeout(500);
console.log("  esc      closed:", await p.evaluate(() => document.getElementById("sheet").hidden));

// ink switch
await p.click('.ink[data-ink="light"]');
await p.waitForTimeout(400);
console.log("  ink      ", await p.evaluate(() => window.__tinct.ink));

await ctx.close();
await browser.close();
console.log("\n audit done");
