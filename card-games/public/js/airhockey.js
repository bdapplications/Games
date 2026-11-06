// Air hockey: you vs. the phone (3 levels) or two players on one phone (top vs. bottom half).
// First to 7 wins. Physics runs in small fixed steps so a fast puck can't pass through a mallet.
import { store } from "./ui.js";

// Table in logical units (scaled to fit the screen).
const W = 300, H = 500;
const PUCK_R = 12, MALLET_R = 21, GOAL_W = 110;
const GOAL_L = (W - GOAL_W) / 2, GOAL_R = (W + GOAL_W) / 2;
const STEP = 1 / 240;
const MAX_PUCK = 1100;        // units per second
const FRICTION = 0.55;        // fraction of speed kept per second
const WALL_BOUNCE = 0.88;
const MALLET_BOUNCE = 0.92;
const WIN_SCORE = 7;
const LEVELS = {
  easy:   { speed: 260, react: 0.55, attack: 0.25 },
  medium: { speed: 480, react: 0.8,  attack: 0.6 },
  hard:   { speed: 760, react: 1,    attack: 1 },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function mount(root) {
  let mode = store.get("ah:mode", "medium"); // easy | medium | hard | friend
  root.innerHTML = `
    <div class="seg" id="ahModes">
      ${["easy", "medium", "hard", "friend"].map((m) => `<button data-mode="${m}" class="${m === mode ? "on" : ""}">${{ easy: "Easy", medium: "Medium", hard: "Hard", friend: "2 Players" }[m]}</button>`).join("")}
    </div>
    <div class="ah-wrap"><canvas id="ah" aria-label="Air hockey table"></canvas></div>
    <p class="sub" id="ahHint"></p>`;
  const canvas = root.querySelector("#ah");
  const ctx = canvas.getContext("2d");
  const hint = root.querySelector("#ahHint");

  let scale = 1;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let alive = true;

  const puck = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  const bottom = { x: W / 2, y: H - 60, vx: 0, vy: 0, tx: W / 2, ty: H - 60 }; // you (or player 1)
  const top = { x: W / 2, y: 60, vx: 0, vy: 0, tx: W / 2, ty: 60 };           // phone (or player 2)
  let score = { top: 0, bottom: 0 };
  let state = "ready"; // ready | play | goal | over
  let banner = "";
  let pauseUntil = 0;
  let serveTo = "bottom";
  const pointers = new Map(); // pointerId -> "top" | "bottom"

  function resetPositions() {
    puck.vx = puck.vy = 0;
    puck.x = W / 2;
    puck.y = serveTo === "bottom" ? H * 0.62 : H * 0.38;
    Object.assign(bottom, { x: W / 2, y: H - 60, vx: 0, vy: 0, tx: W / 2, ty: H - 60 });
    Object.assign(top, { x: W / 2, y: 60, vx: 0, vy: 0, tx: W / 2, ty: 60 });
  }

  function newGame() {
    score = { top: 0, bottom: 0 };
    serveTo = Math.random() < 0.5 ? "bottom" : "top";
    resetPositions();
    state = "ready";
    banner = "Tap to start";
    updateHint();
  }

  function updateHint() {
    hint.textContent =
      mode === "friend"
        ? "Each player drags their mallet in their own half. First to 7."
        : "Drag your gold mallet in the bottom half. First to 7.";
  }

  // ---------- Sizing ----------
  function resize() {
    const wrap = canvas.parentElement;
    const topOffset = wrap.getBoundingClientRect().top;
    const availH = Math.max(320, window.innerHeight - topOffset - 64);
    const availW = wrap.clientWidth;
    scale = Math.min(availW / W, availH / H);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = W * scale + "px";
    canvas.style.height = H * scale + "px";
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    draw();
  }

  // ---------- Input ----------
  function toTable(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  function aim(side, p, isTouch) {
    const m = side === "bottom" ? bottom : top;
    // On touch, keep the mallet a little ahead of the finger so you can see it.
    const lift = isTouch ? (side === "bottom" ? -18 : 18) : 0;
    m.tx = p.x;
    m.ty = p.y + lift;
  }

  function onDown(e) {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    if (state === "over") return newGame();
    if (state === "ready") {
      state = "play";
      banner = "";
    }
    const p = toTable(e);
    const side = mode === "friend" ? (p.y < H / 2 ? "top" : "bottom") : "bottom";
    pointers.set(e.pointerId, side);
    aim(side, p, e.pointerType === "touch");
  }
  function onMove(e) {
    const side = pointers.get(e.pointerId);
    if (!side) return;
    e.preventDefault();
    aim(side, toTable(e), e.pointerType === "touch");
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  window.addEventListener("resize", resize);

  root.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      store.set("ah:mode", mode);
      root.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("on", x === b));
      newGame();
    })
  );

  // ---------- Computer player ----------
  let aimX = 0, strikeT = 0;
  function computer(dt) {
    const lvl = LEVELS[mode];
    if (strikeT > 0 && (strikeT -= dt) <= 0) aimX = 0; // pick a new aim point for the next shot
    if (puck.y >= H / 2 + 10 && strikeT <= 0) aimX = 0;
    const homeY = 55;
    let tx, ty;
    const inMyHalf = puck.y < H / 2 + 10;
    const comingAtMe = puck.vy < 0;
    if (inMyHalf && (puck.vy > -120 || Math.random() < lvl.attack * dt * 8)) {
      // Attack: line up behind the puck on the line to your goal, then drive through it.
      if (!aimX) aimX = W / 2 + (Math.random() - 0.5) * GOAL_W * 0.7 * lvl.react;
      let dx = aimX - puck.x, dy = H + 30 - puck.y;
      const d = Math.hypot(dx, dy);
      dx /= d; dy /= d;
      const back = MALLET_R + PUCK_R + 10;
      const ax = puck.x - dx * back, ay = puck.y - dy * back;
      const offLine = Math.abs((top.x - puck.x) * dy - (top.y - puck.y) * dx);
      const lined = Math.hypot(top.x - ax, top.y - ay) < 5 || (top.y < puck.y - PUCK_R && offLine < 2.5);
      if (lined || strikeT > 0) {
        if (lined && strikeT <= 0) strikeT = 0.3;
        // drive straight along the aim line, so contact sends the puck where it was aimed
        tx = top.x + dx * 80;
        ty = top.y + dy * 80;
      } else if (top.y > puck.y - PUCK_R) {
        // Puck is between me and my goal: go around it rather than knock it into my own net.
        tx = puck.x + (top.x < puck.x ? -1 : 1) * (MALLET_R + PUCK_R + 8);
        ty = puck.y - MALLET_R - PUCK_R;
      } else {
        tx = ax;
        ty = ay;
      }
    } else if (comingAtMe) {
      // Defend: slide across to where the puck is heading.
      const t = (puck.y - homeY) / -puck.vy;
      let px = puck.x + puck.vx * t * lvl.react;
      // fold the bounce off the side walls
      for (let i = 0; i < 3; i++) {
        if (px < PUCK_R) px = 2 * PUCK_R - px;
        if (px > W - PUCK_R) px = 2 * (W - PUCK_R) - px;
      }
      tx = clamp(px, GOAL_L - 10, GOAL_R + 10);
      ty = homeY;
    } else {
      tx = W / 2 + (puck.x - W / 2) * 0.4;
      ty = homeY;
    }
    top.tx = tx;
    top.ty = ty;
    return lvl.speed;
  }

  // ---------- Physics ----------
  function moveMallet(m, side, dt, maxSpeed) {
    const minY = side === "top" ? MALLET_R : H / 2 + MALLET_R;
    const maxY = side === "top" ? H / 2 - MALLET_R : H - MALLET_R;
    const tx = clamp(m.tx, MALLET_R, W - MALLET_R);
    const ty = clamp(m.ty, minY, maxY);
    let dx = tx - m.x, dy = ty - m.y;
    const dist = Math.hypot(dx, dy);
    const maxStep = maxSpeed * dt;
    if (dist > maxStep) {
      dx *= maxStep / dist;
      dy *= maxStep / dist;
    }
    m.x += dx;
    m.y += dy;
    // smoothed velocity, used to transfer "hit" energy to the puck
    m.vx = m.vx * 0.6 + (dx / dt) * 0.4;
    m.vy = m.vy * 0.6 + (dy / dt) * 0.4;
  }

  function collide(m) {
    const dx = puck.x - m.x, dy = puck.y - m.y;
    const dist = Math.hypot(dx, dy);
    const minD = PUCK_R + MALLET_R;
    if (dist >= minD || dist === 0) return;
    const nx = dx / dist, ny = dy / dist;
    // push the puck out of the mallet
    puck.x = m.x + nx * minD;
    puck.y = m.y + ny * minD;
    const rvx = puck.vx - m.vx, rvy = puck.vy - m.vy;
    const along = rvx * nx + rvy * ny;
    if (along < 0) {
      puck.vx -= (1 + MALLET_BOUNCE) * along * nx;
      puck.vy -= (1 + MALLET_BOUNCE) * along * ny;
    }
  }

  function step(dt) {
    const humanSpeed = 2600;
    moveMallet(bottom, "bottom", dt, humanSpeed);
    moveMallet(top, "top", dt, mode === "friend" ? humanSpeed : computer(dt));

    puck.x += puck.vx * dt;
    puck.y += puck.vy * dt;
    const keep = Math.pow(FRICTION, dt);
    puck.vx *= keep;
    puck.vy *= keep;

    // side walls
    if (puck.x < PUCK_R) { puck.x = PUCK_R; puck.vx = Math.abs(puck.vx) * WALL_BOUNCE; }
    if (puck.x > W - PUCK_R) { puck.x = W - PUCK_R; puck.vx = -Math.abs(puck.vx) * WALL_BOUNCE; }

    // end walls, except where the goal mouth is
    const inMouth = puck.x > GOAL_L + PUCK_R * 0.4 && puck.x < GOAL_R - PUCK_R * 0.4;
    if (!inMouth) {
      if (puck.y < PUCK_R) { puck.y = PUCK_R; puck.vy = Math.abs(puck.vy) * WALL_BOUNCE; }
      if (puck.y > H - PUCK_R) { puck.y = H - PUCK_R; puck.vy = -Math.abs(puck.vy) * WALL_BOUNCE; }
    } else {
      if (puck.y < -PUCK_R) return goal("bottom");
      if (puck.y > H + PUCK_R) return goal("top");
    }

    collide(bottom);
    collide(top);

    const sp = Math.hypot(puck.vx, puck.vy);
    if (sp > MAX_PUCK) {
      puck.vx *= MAX_PUCK / sp;
      puck.vy *= MAX_PUCK / sp;
    }
  }

  function goal(scorer) {
    score[scorer] += 1;
    serveTo = scorer === "bottom" ? "top" : "bottom"; // the player who was scored on gets the puck
    const done = score[scorer] >= WIN_SCORE;
    if (mode === "friend") banner = done ? `${scorer === "bottom" ? "Bottom" : "Top"} player wins!` : "Goal!";
    else banner = done ? (scorer === "bottom" ? "You win!" : "Phone wins") : scorer === "bottom" ? "Goal!" : "Phone scores";
    if (done) {
      state = "over";
      banner += "  Tap to play again";
    } else {
      state = "goal";
      pauseUntil = performance.now() + 1100;
    }
    try { navigator.vibrate?.(60); } catch {}
  }

  // ---------- Drawing ----------
  function draw() {
    ctx.clearRect(0, 0, W, H);
    // table
    ctx.fillStyle = "#eef6fb";
    roundRect(0, 0, W, H, 18);
    ctx.fill();
    ctx.save();
    roundRect(0, 0, W, H, 18);
    ctx.clip();

    // goal mouths
    ctx.fillStyle = "#1b2a35";
    ctx.fillRect(GOAL_L, -6, GOAL_W, 10);
    ctx.fillRect(GOAL_L, H - 4, GOAL_W, 10);

    // markings
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(211,58,58,.55)";
    line(0, H / 2, W, H / 2);
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 46, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(47,111,214,.45)";
    ctx.beginPath(); ctx.arc(W / 2, 0, GOAL_W / 2 + 8, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H, GOAL_W / 2 + 8, Math.PI, 0); ctx.stroke();

    // scores
    ctx.fillStyle = "rgba(20,40,60,.16)";
    ctx.font = "800 64px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(score.top, W - 44, H / 2 - 52);
    ctx.fillText(score.bottom, W - 44, H / 2 + 54);
    ctx.restore();

    // mallets and puck
    mallet(top, mode === "friend" ? "#2f6fd6" : "#d33a3a");
    mallet(bottom, "#f2c94c");
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.beginPath(); ctx.arc(puck.x + 2, puck.y + 3, PUCK_R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1d1d1f";
    ctx.beginPath(); ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#555"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(puck.x, puck.y, PUCK_R - 4, 0, Math.PI * 2); ctx.stroke();

    if (banner) {
      ctx.fillStyle = "rgba(10,30,22,.78)";
      roundRect(20, H / 2 - 28, W - 40, 56, 14);
      ctx.fill();
      ctx.fillStyle = "#f2c94c";
      ctx.font = "700 21px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const parts = banner.split("  ");
      if (parts.length > 1) {
        ctx.fillText(parts[0], W / 2, H / 2 - 9);
        ctx.font = "600 13px -apple-system, system-ui, sans-serif";
        ctx.fillStyle = "#f5f7f4";
        ctx.fillText(parts[1], W / 2, H / 2 + 14);
      } else ctx.fillText(banner, W / 2, H / 2);
    }
  }

  function mallet(m, color) {
    ctx.fillStyle = "rgba(0,0,0,.2)";
    ctx.beginPath(); ctx.arc(m.x + 2, m.y + 4, MALLET_R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(m.x, m.y, MALLET_R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.35)";
    ctx.beginPath(); ctx.arc(m.x, m.y, MALLET_R * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(m.x, m.y, MALLET_R * 0.38, 0, Math.PI * 2); ctx.fill();
  }
  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- Loop ----------
  function frame(now) {
    if (!alive) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000); // clamp after the app was in the background
    last = now;
    if (state === "goal" && now >= pauseUntil) {
      resetPositions();
      state = "play";
      banner = "";
    }
    if (state === "play") {
      acc += dt;
      while (acc >= STEP) {
        step(STEP);
        acc -= STEP;
        if (state !== "play") break;
      }
    } else acc = 0;
    draw();
    raf = requestAnimationFrame(frame);
  }

  newGame();
  requestAnimationFrame(() => {
    resize();
    raf = requestAnimationFrame(frame);
  });

  // exposed for automated testing only
  window.__airhockey = { puck, top, bottom, score: () => score, state: () => state };

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    delete window.__airhockey;
  };
}
