/* ═══════════════════════════════════════════════════════════
   TINCT — the vat
   A coarse velocity field carries dye particles and a handful
   of drifting labels. Stir with the cursor, throw the labels,
   click one to open it.
   ═══════════════════════════════════════════════════════════ */

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

const INKS = {
  signal: { hex: "#3ee7f2", rgb: [62, 231, 242] },
  press: { hex: "#ff4fa3", rgb: [255, 79, 163] },
  light: { hex: "#ffb020", rgb: [255, 176, 32] },
  night: { hex: "#8b5cf6", rgb: [139, 92, 246] },
};

const canvas = document.getElementById("vat");
const ctx = canvas.getContext("2d", { alpha: false });
const bodiesEl = document.getElementById("bodies");
const sheet = document.getElementById("sheet");
const hint = document.getElementById("hint");
const stat = document.getElementById("stat");

let W = 0;
let H = 0;
let DPR = 1;
let time = 0;
let currentInk = "signal";

/* ── velocity field ──────────────────────────────────────── */
const GW = 72;
const GH = 44;
const vx = new Float32Array(GW * GH);
const vy = new Float32Array(GW * GH);
const tx = new Float32Array(GW * GH);
const ty = new Float32Array(GW * GH);

function gridIndex(x, y) {
  const gx = Math.max(0, Math.min(GW - 1, Math.floor((x / W) * GW)));
  const gy = Math.max(0, Math.min(GH - 1, Math.floor((y / H) * GH)));
  return gy * GW + gx;
}

function sampleField(x, y) {
  const i = gridIndex(x, y);
  return { x: vx[i], y: vy[i] };
}

function splat(x, y, fx, fy, radius) {
  const r = radius;
  const gx = (x / W) * GW;
  const gy = (y / H) * GH;
  const reach = Math.max(1.2, (r / W) * GW);
  const x0 = Math.max(0, Math.floor(gx - reach));
  const x1 = Math.min(GW - 1, Math.ceil(gx + reach));
  const y0 = Math.max(0, Math.floor(gy - reach));
  const y1 = Math.min(GH - 1, Math.ceil(gy + reach));
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      const dx = i - gx;
      const dy = j - gy;
      const d2 = dx * dx + dy * dy;
      const fall = Math.exp(-d2 / (reach * reach * 0.5));
      if (fall < 0.01) continue;
      const k = j * GW + i;
      vx[k] += fx * fall;
      vy[k] += fy * fall;
    }
  }
}

function stepField() {
  // decay
  for (let i = 0; i < vx.length; i++) {
    vx[i] *= 0.982;
    vy[i] *= 0.982;
  }
  // cheap diffusion so the flow smears like liquid
  for (let j = 1; j < GH - 1; j++) {
    for (let i = 1; i < GW - 1; i++) {
      const k = j * GW + i;
      tx[k] = (vx[k] * 2 + vx[k - 1] + vx[k + 1] + vx[k - GW] + vx[k + GW]) * 0.1666;
      ty[k] = (vy[k] * 2 + vy[k - 1] + vy[k + 1] + vy[k - GW] + vy[k + GW]) * 0.1666;
    }
  }
  vx.set(tx);
  vy.set(ty);
}

// slow ambient current so the vat is never dead
function ambient() {
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const k = j * GW + i;
      const n = Math.sin(i * 0.17 + time * 0.32) * Math.cos(j * 0.21 - time * 0.26);
      vx[k] += n * 0.055;
      vy[k] += Math.cos(i * 0.13 - time * 0.21) * 0.055;
    }
  }
}

/* ── dye particles ───────────────────────────────────────── */
const sprites = {};
for (const key of Object.keys(INKS)) {
  const s = document.createElement("canvas");
  s.width = s.height = 64;
  const c = s.getContext("2d");
  const [r, g, b] = INKS[key].rgb;
  const grad = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.28, `rgba(${r},${g},${b},0.5)`);
  grad.addColorStop(0.62, `rgba(${r},${g},${b},0.13)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = grad;
  c.fillRect(0, 0, 64, 64);
  sprites[key] = s;
}

let particles = [];
function particleCount() {
  return Math.round(Math.min(2200, Math.max(700, (W * H) / 900)));
}

function spawn(p, nearPointer) {
  const ink = Math.random() < 0.82 ? currentInk : Object.keys(INKS)[(Math.random() * 4) | 0];
  if (nearPointer && pointer.active) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 26;
    p.x = pointer.x + Math.cos(a) * r;
    p.y = pointer.y + Math.sin(a) * r;
  } else {
    p.x = Math.random() * W;
    p.y = Math.random() * H;
  }
  p.vx = (Math.random() - 0.5) * 1.4;
  p.vy = (Math.random() - 0.5) * 1.4;
  p.life = 0.35 + Math.random() * 0.65;
  p.size = 5 + Math.random() * 17;
  p.ink = ink;
  p.seed = Math.random() * 100;
}

function buildParticles() {
  const n = particleCount();
  particles = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = {};
    spawn(p, false);
    p.life = Math.random();
    particles[i] = p;
  }
}

function stepParticles(dt) {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const f = sampleField(p.x, p.y);
    p.vx += (f.x * 1.15 - p.vx) * 0.075;
    p.vy += (f.y * 1.15 - p.vy) * 0.075;

    // a little curl so it never looks like straight lines
    p.vx += Math.sin(p.y * 0.011 + time * 0.5 + p.seed) * 0.09;
    p.vy += Math.cos(p.x * 0.011 - time * 0.42 + p.seed) * 0.09;

    p.x += p.vx * dt * 62;
    p.y += p.vy * dt * 62;
    p.life -= dt * 0.115;

    if (p.life <= 0 || p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) {
      spawn(p, Math.random() < 0.45);
    }
  }
}

function drawParticles() {
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const fade = p.life < 0.28 ? p.life / 0.28 : 1;
    const s = sprites[p.ink];
    const glow = p.size * 3.1;
    ctx.globalAlpha = 0.055 * fade;
    ctx.drawImage(s, p.x - glow * 0.5, p.y - glow * 0.5, glow, glow);
    ctx.globalAlpha = 0.3 * fade;
    const core = p.size;
    ctx.drawImage(s, p.x - core * 0.5, p.y - core * 0.5, core, core);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/* ── bodies ──────────────────────────────────────────────── */
const bodies = [];
let held = null;

function measureBodies() {
  const els = [...document.querySelectorAll(".body")];
  if (bodies.length !== els.length) {
    bodies.length = 0;
    els.forEach((el, i) => {
      bodies.push({
        el,
        sheetId: el.dataset.sheet,
        x: 0, y: 0, vx: 0, vy: 0,
        angle: 0, va: 0,
        w: 0, h: 0,
        homeX: 0, homeY: 0,
        mass: 1,
        seed: i * 1.7 + Math.random(),
      });
    });
  }
  bodies.forEach((b) => {
    // offsetWidth is the untransformed layout box — rotation must not
    // inflate the collision and wall maths
    b.w = b.el.offsetWidth || b.el.getBoundingClientRect().width;
    b.h = b.el.offsetHeight || b.el.getBoundingClientRect().height;
    b.mass = Math.max(0.7, Math.min(2.6, (b.w * b.h) / 26000));
  });
  layoutHomes();
}

/* one source of truth for where labels are allowed to live */
function safeArea() {
  const narrow = W < 620;
  return {
    x: narrow ? 10 : 18,
    top: narrow ? 76 : 86,
    right: W - (narrow ? 10 : 18),
    bottom: H - (narrow ? 58 : 72),
  };
}

function layoutHomes() {
  // 1. seed slots by role
  const narrow = W < 620;
  const mid = W < 1020;
  bodies.forEach((b, i) => {
    const isBrand = b.el.classList.contains("body--brand");
    const isCta = b.el.classList.contains("body--cta");
    let fx;
    let fy;
    if (isBrand) {
      fx = narrow ? 0.5 : 0.31;
      fy = narrow ? 0.11 : 0.42;
    } else if (isCta) {
      fx = narrow ? 0.5 : 0.38;
      fy = narrow ? 0.92 : 0.83;
    } else if (narrow) {
      const k = i - 1; // 0..3
      fx = k % 2 === 0 ? 0.25 : 0.75;
      fy = 0.36 + Math.floor(k / 2) * 0.27;
    } else if (mid) {
      const k = i - 1;
      fx = 0.28 + (k % 2) * 0.42;
      fy = 0.26 + Math.floor(k / 2) * 0.28;
    } else {
      const k = i - 1;
      fx = 0.64 + (k % 2) * 0.19;
      fy = 0.19 + Math.floor(k / 2) * 0.21;
    }
    b.homeX = W * fx;
    b.homeY = H * fy;
    if (!b.placed) {
      b.x = b.homeX + (Math.random() - 0.5) * 80;
      b.y = b.homeY + (Math.random() - 0.5) * 60;
      b.placed = true;
    }
  });

  // 2. relax: separate, then clamp, alternating until it holds still
  const S = safeArea();
  const clamp = () => {
    for (const b of bodies) {
      const hw = b.w / 2;
      const hh = b.h / 2;
      b.homeX = Math.max(S.x + hw, Math.min(S.right - hw, b.homeX));
      b.homeY = Math.max(S.top + hh, Math.min(S.bottom - hh, b.homeY));
    }
  };
  const separate = () => {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const c = bodies[j];
        const dx = c.homeX - a.homeX;
        const dy = c.homeY - a.homeY;
        const ox = (a.w + c.w) / 2 + 16 - Math.abs(dx);
        const oy = (a.h + c.h) / 2 + 16 - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          const s = Math.sign(dx) || 1;
          const t = Math.sign(dy) || 1;
          if (ox * 1.2 < oy) {
            a.homeX -= (ox / 2) * s;
            c.homeX += (ox / 2) * s;
          } else {
            a.homeY -= (oy / 2) * t;
            c.homeY += (oy / 2) * t;
          }
        }
      }
    }
  };

  for (let iter = 0; iter < 260; iter++) {
    clamp();
    separate();
    if (iter % 20 === 19) clamp();
  }
  clamp();
}

function stepBodies(dt) {
  const s = dt * 60; // frame-normalised step
  for (const b of bodies) {
    if (held === b) {
      // tracked by the pointer — responsive, with the mass felt on release
      const k = Math.min(1, dt * 34);
      const nx = b.x + (pointer.x - b.grabX - b.x) * k;
      const ny = b.y + (pointer.y - b.grabY - b.y) * k;
      b.vx = (nx - b.x) / Math.max(s, 0.001);
      b.vy = (ny - b.y) / Math.max(s, 0.001);
      b.x = nx;
      b.y = ny;
    } else {
      const f = sampleField(b.x, b.y);
      const inv = 1 / b.mass;
      b.vx += f.x * 0.5 * inv * s;
      b.vy += f.y * 0.5 * inv * s;

      // homing: keeps the composition legible, weak enough to shove around
      b.vx += (b.homeX - b.x) * 0.012 * s;
      b.vy += (b.homeY - b.y) * 0.012 * s;

      const damp = Math.pow(0.945, s);
      b.vx *= damp;
      b.vy *= damp;
      b.x += b.vx * s;
      b.y += b.vy * s;
    }

    // spin from the flow, settle flat
    const f2 = sampleField(b.x, b.y);
    b.va += f2.x * 0.0016 * s;
    b.va *= Math.pow(0.93, s);
    b.angle += b.va * s;
    b.angle *= Math.pow(0.97, s);

    // walls — hold the labels clear of the chrome bands
    const S = safeArea();
    const m = 4;
    const hw = b.w / 2;
    const hh = b.h / 2;
    if (b.x - hw < S.x + m) { b.x = S.x + m + hw; b.vx = Math.abs(b.vx) * 0.55; }
    if (b.x + hw > S.right - m) { b.x = S.right - m - hw; b.vx = -Math.abs(b.vx) * 0.55; }
    if (b.y - hh < S.top + m) { b.y = S.top + m + hh; b.vy = Math.abs(b.vy) * 0.55; }
    if (b.y + hh > S.bottom - m) { b.y = S.bottom - m - hh; b.vy = -Math.abs(b.vy) * 0.55; }
  }

  // body ↔ body collisions (circle approx)
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const ra = Math.max(a.w, a.h) * 0.42;
      const rb = Math.max(b.w, b.h) * 0.42;
      const dist = Math.hypot(dx, dy) || 0.001;
      const min = ra + rb;
      if (dist < min) {
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = (min - dist) * 0.5;
        const aMove = held === a ? 0 : 1;
        const bMove = held === b ? 0 : 1;
        a.x -= nx * overlap * aMove;
        a.y -= ny * overlap * aMove;
        b.x += nx * overlap * bMove;
        b.y += ny * overlap * bMove;
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const speed = rvx * nx + rvy * ny;
        if (speed < 0) {
          const imp = speed * 0.55;
          a.vx += nx * imp * aMove;
          a.vy += ny * imp * aMove;
          b.vx -= nx * imp * bMove;
          b.vy -= ny * imp * bMove;
        }
      }
    }
  }
}

function renderBodies() {
  for (const b of bodies) {
    b.el.style.transform =
      `translate3d(${(b.x - b.w / 2).toFixed(2)}px, ${(b.y - b.h / 2).toFixed(2)}px, 0) rotate(${b.angle.toFixed(3)}deg)`;
  }
}

/* ── pointer ─────────────────────────────────────────────── */
const pointer = {
  x: -9999,
  y: -9999,
  px: -9999,
  py: -9999,
  active: false,
  down: false,
  moved: 0,
  downT: 0,
};

function onMove(e) {
  const nx = e.clientX;
  const ny = e.clientY;
  if (pointer.active) {
    const dx = nx - pointer.x;
    const dy = ny - pointer.y;
    const speed = Math.hypot(dx, dy);
    if (speed > 0.2) {
      splat(nx, ny, dx * 0.22, dy * 0.22, 120 + Math.min(120, speed));
      if (!REDUCED && speed > 2) {
        const n = Math.min(9, 1 + (speed / 8) | 0);
        for (let i = 0; i < n; i++) {
          const p = particles[(Math.random() * particles.length) | 0];
          if (p) spawn(p, true);
        }
      }
    }
    if (held) pointer.moved += speed;
  }
  pointer.px = pointer.x;
  pointer.py = pointer.y;
  pointer.x = nx;
  pointer.y = ny;
  pointer.active = true;
}

function onDown(e) {
  if (e.target.closest && e.target.closest(".top, .bottom, .sheet")) return;
  pointer.down = true;
  pointer.moved = 0;
  pointer.downT = performance.now();
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.px = pointer.x;
  pointer.py = pointer.y;
  pointer.active = true;

  const el = e.target.closest && e.target.closest(".body");
  if (el) {
    const b = bodies.find((x) => x.el === el);
    if (b) {
      held = b;
      b.el.classList.add("is-held");
      b.grabX = pointer.x - b.x;
      b.grabY = pointer.y - b.y;
      document.body.classList.add("is-drag");
      killHint();
      e.preventDefault();
      return;
    }
  }
  killHint();
  // a poke in open water: shove whatever is nearby
  splat(e.clientX, e.clientY, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, 150);
}

function onUp(e) {
  pointer.down = false;
  document.body.classList.remove("is-drag");
  if (!held) return;
  const b = held;
  const wasClick = pointer.moved < 9 && performance.now() - pointer.downT < 500;
  b.vx *= 1.12;
  b.vy *= 1.12;
  b.el.classList.remove("is-held");
  held = null;
  if (wasClick) openSheet(b.sheetId);
}

function killHint() {
  hint.classList.add("is-dead");
}

/* ── sheet ───────────────────────────────────────────────── */
let openId = null;

function openSheet(id) {
  const panel = sheet.querySelector(`[data-panel="${id}"]`);
  if (!panel) return;
  openId = id;
  sheet.hidden = false;
  sheet.querySelectorAll("[data-panel]").forEach((p) => {
    const on = p === panel;
    p.hidden = !on;
    p.classList.remove("is-in");
    if (on) {
      void p.offsetWidth;
      p.classList.add("is-in");
    }
  });
  requestAnimationFrame(() => sheet.classList.add("is-open"));
  stat.textContent = id === "batch" ? "VAT OPEN" : `OPEN · ${id.toUpperCase()}`;
}

function closeSheet() {
  if (!openId) return;
  openId = null;
  sheet.classList.remove("is-open");
  stat.textContent = `${currentInk.toUpperCase()} LOADED`;
  setTimeout(() => {
    if (openId) return;
    sheet.hidden = true;
    sheet.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = true));
  }, REDUCED ? 20 : 420);
}

sheet.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) closeSheet();
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheet();
});

/* ink selector */
document.querySelectorAll(".ink").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentInk = btn.dataset.ink;
    document.querySelectorAll(".ink").forEach((b) => b.classList.toggle("is-on", b === btn));
    stat.textContent = `${currentInk.toUpperCase()} LOADED`;
    // dye the vat with a burst of the new colour
    for (let i = 0; i < 160; i++) {
      const p = particles[(Math.random() * particles.length) | 0];
      if (p) spawn(p, false);
    }
    splat(W / 2, H / 2, 0, -22, 220);
    killHint();
  });
});

/* ── loop ────────────────────────────────────────────────── */
let last = performance.now();
let frozen = false;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000) || 0.016;
  last = now;
  time += dt;

  if (!frozen) {
    if (!REDUCED) ambient();
    stepField();
    stepParticles(dt);
    stepBodies(dt);
  }
  renderBodies();
  drawParticles();

  requestAnimationFrame(frame);
}

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  measureBodies();
  if (particles.length !== particleCount()) buildParticles();
}

function boot() {
  resize();
  buildParticles();
  stat.textContent = "SIGNAL LOADED";
  requestAnimationFrame(frame);
  // welcome swirl
  if (!REDUCED) {
    setTimeout(() => {
      splat(W * 0.32, H * 0.62, 26, -10, 190);
      splat(W * 0.7, H * 0.36, -22, 12, 190);
    }, 260);
    setTimeout(() => {
      splat(W * 0.5, H * 0.5, 14, -16, 240);
    }, 780);
  }
}

addEventListener("resize", resize);
addEventListener("pointermove", onMove, { passive: true });
addEventListener("pointerdown", onDown);
addEventListener("pointerup", onUp);
addEventListener("pointercancel", onUp);
addEventListener("pointerleave", () => {
  pointer.active = false;
});

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(boot).catch(boot);
} else {
  addEventListener("load", boot);
}

/* ── test harness ────────────────────────────────────────── */
window.__tinct = {
  get bodies() {
    return bodies.map((b) => ({
      sheet: b.sheetId,
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.w),
      h: Math.round(b.h),
    }));
  },
  get particles() {
    return particles.length;
  },
  get ink() {
    return currentInk;
  },
  stir(x, y, fx, fy) {
    splat(x, y, fx, fy, 140);
    for (let i = 0; i < 40; i++) {
      const p = particles[(Math.random() * particles.length) | 0];
      if (p) spawn(p, true);
    }
    pointer.x = x;
    pointer.y = y;
    pointer.active = true;
  },
  inkTo(k) {
    currentInk = k;
    document.querySelectorAll(".ink").forEach((b) => b.classList.toggle("is-on", b.dataset.ink === k));
  },
  open: openSheet,
  close: closeSheet,
  snap() {
    for (const b of bodies) {
      b.x = b.homeX;
      b.y = b.homeY;
      b.vx = 0;
      b.vy = 0;
      b.angle = 0;
      b.va = 0;
    }
    frozen = true;
  },
  thaw() {
    frozen = false;
    measureBodies();
  },
  homes() {
    return bodies.map((b) => ({
      sheet: b.sheetId,
      w: Math.round(b.w),
      h: Math.round(b.h),
      hx: Math.round(b.homeX),
      hy: Math.round(b.homeY),
      x: Math.round(b.x),
      y: Math.round(b.y),
    }));
  },
  fieldEnergy() {
    let e = 0;
    for (let i = 0; i < vx.length; i++) e += vx[i] * vx[i] + vy[i] * vy[i];
    return +(e / vx.length).toFixed(3);
  },
};
